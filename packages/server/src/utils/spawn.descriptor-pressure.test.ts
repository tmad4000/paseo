import { afterEach, describe, expect, test, vi } from "vitest";

const spawnFailures = vi.hoisted(() => ({ remaining: 0, code: "EBADF" }));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  const failOrRun =
    <Args extends unknown[], Result>(original: (...args: Args) => Result) =>
    (...args: Args): Result => {
      if (spawnFailures.remaining > 0) {
        spawnFailures.remaining--;
        // Mirrors node:internal/child_process, which throws EBADF synchronously.
        throw Object.assign(new Error(`spawn ${spawnFailures.code}`), {
          code: spawnFailures.code,
          errno: -9,
          syscall: "spawn",
        });
      }
      return original(...args);
    };
  const { promisify } = await vi.importActual<typeof import("node:util")>("node:util");
  const execFile = Object.assign(
    failOrRun(actual.execFile as (...args: unknown[]) => ReturnType<typeof actual.execFile>),
    {
      // Keep execFile's promisified { stdout, stderr } shape.
      [promisify.custom]: failOrRun(
        (actual.execFile as unknown as Record<symbol, (...args: unknown[]) => unknown>)[
          promisify.custom
        ],
      ),
    },
  );
  return {
    ...actual,
    spawn: failOrRun(actual.spawn as (...args: unknown[]) => ReturnType<typeof actual.spawn>),
    execFile,
  };
});

const { SpawnDescriptorPressureError, execCommand, retryOnSpawnDescriptorPressure, spawnProcess } =
  await import("./spawn.js");
const { runGitCommand } = await import("./run-git-command.js");

afterEach(() => {
  spawnFailures.remaining = 0;
  spawnFailures.code = "EBADF";
});

describe("spawn descriptor pressure", () => {
  test("spawnProcess explains EBADF instead of surfacing a bare errno", () => {
    spawnFailures.remaining = 1;
    let caught: unknown;
    try {
      spawnProcess("git", ["--version"]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SpawnDescriptorPressureError);
    const error = caught as InstanceType<typeof SpawnDescriptorPressureError>;
    expect(error.code).toBe("EBADF");
    expect(error.syscall).toBe("spawn");
    expect(error.message).toContain("too many open file descriptors");
    expect(error.message).toContain("10240");
    expect(error.message).toContain("git");
  });

  test("execCommand retries a spawn that never started", async () => {
    spawnFailures.remaining = 2;
    const result = await execCommand("echo", ["recovered"]);
    expect(result.stdout.trim()).toBe("recovered");
    expect(spawnFailures.remaining).toBe(0);
  });

  test("git commands retry through a transient descriptor burst", async () => {
    spawnFailures.remaining = 1;
    const result = await runGitCommand(["--version"], { cwd: process.cwd() });
    expect(result.stdout).toMatch(/^git version/);
  });

  test("retries stop after the configured attempts", async () => {
    let attempts = 0;
    const failure = Object.assign(new Error("spawn EMFILE"), {
      code: "EMFILE",
      syscall: "spawn git",
    });
    await expect(
      retryOnSpawnDescriptorPressure(async () => {
        attempts++;
        throw failure;
      }, [0, 0]),
    ).rejects.toBe(failure);
    expect(attempts).toBe(3);
  });

  test("ordinary command failures are not retried", async () => {
    let attempts = 0;
    const failure = Object.assign(new Error("spawn missing ENOENT"), {
      code: "ENOENT",
      syscall: "spawn missing",
    });
    await expect(
      retryOnSpawnDescriptorPressure(async () => {
        attempts++;
        throw failure;
      }, [0, 0]),
    ).rejects.toBe(failure);
    expect(attempts).toBe(1);
  });
});
