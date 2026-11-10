import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { createDaemonTestContext, type DaemonTestContext } from "../test-utils/index.js";

function tmpCwd(): string {
  return mkdtempSync(path.join(tmpdir(), "daemon-e2e-"));
}

// Use gpt-5.4-mini with low thinking preset for faster test execution
const CODEX_TEST_MODEL = "gpt-5.4-mini";
const CODEX_TEST_THINKING_OPTION_ID = "low";

let ctx: DaemonTestContext;

beforeEach(async () => {
  ctx = await createDaemonTestContext();
});

afterEach(async () => {
  await ctx.cleanup();
}, 60000);

describe("checkout discard", () => {
  test.each([".", "apps/web"])(
    "discards selected Changes from the %s workspace without changing siblings",
    async (workspacePath) => {
      const cwd = tmpCwd();
      function git(args: string[]): string {
        return execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" });
      }
      try {
        git(["init", "-b", "main"]);
        git(["config", "user.name", "Paseo Test"]);
        git(["config", "user.email", "test@getpaseo.local"]);
        git(["config", "core.autocrlf", "false"]);
        const nested = path.join(cwd, "apps", "web");
        mkdirSync(nested, { recursive: true });
        writeFileSync(path.join(nested, "target[ab].txt"), "target base\n");
        writeFileSync(path.join(nested, "targeta.txt"), "sibling base\n");
        writeFileSync(path.join(nested, "deleted.txt"), "deleted base\n");
        git(["add", "."]);
        git(["-c", "commit.gpgsign=false", "commit", "-m", "initial"]);
        const creation = await ctx.client.createWorkspace({
          source: { kind: "directory", path: path.join(cwd, workspacePath) },
          title: "Discard regression",
        });
        const workspaceCwd = creation.workspace?.workspaceDirectory;
        if (!workspaceCwd) {
          throw new Error(creation.error ?? "Workspace creation failed");
        }

        writeFileSync(path.join(nested, "target[ab].txt"), "target edited\n");
        writeFileSync(path.join(nested, "targeta.txt"), "sibling edited\n");
        writeFileSync(path.join(nested, "staged.txt"), "staged new file\n");
        writeFileSync(path.join(nested, "scratch.txt"), "untracked file\n");
        git(["--literal-pathspecs", "add", "--", "apps/web/target[ab].txt", "apps/web/staged.txt"]);
        git(["rm", "apps/web/deleted.txt"]);

        const subscription = ctx.client.observeCheckoutDiff(workspaceCwd, { mode: "uncommitted" });
        try {
          const changes = await subscription.ready;
          expect(changes.error).toBeNull();
          expect(changes.files.map((file) => file.path).sort()).toEqual([
            "apps/web/deleted.txt",
            "apps/web/scratch.txt",
            "apps/web/staged.txt",
            "apps/web/target[ab].txt",
            "apps/web/targeta.txt",
          ]);
          const selectedPaths = changes.files
            .filter((file) => file.path !== "apps/web/targeta.txt")
            .map((file) => file.path);
          const discarded = await ctx.client.checkoutDiscardChanges(workspaceCwd, {
            paths: selectedPaths,
          });
          expect(discarded).toMatchObject({ success: true, error: null });

          const target = await ctx.client.readFile(cwd, "apps/web/target[ab].txt");
          expect(new TextDecoder().decode(target.bytes)).toBe("target base\n");
          const restored = await ctx.client.readFile(cwd, "apps/web/deleted.txt");
          expect(new TextDecoder().decode(restored.bytes)).toBe("deleted base\n");
          const sibling = await ctx.client.readFile(cwd, "apps/web/targeta.txt");
          expect(new TextDecoder().decode(sibling.bytes)).toBe("sibling edited\n");
          await expect(ctx.client.readFile(cwd, "apps/web/staged.txt")).rejects.toThrow(/ENOENT/);
          await expect(ctx.client.readFile(cwd, "apps/web/scratch.txt")).rejects.toThrow(/ENOENT/);
          expect(git(["status", "--porcelain=v1", "-z"])).toBe(" M apps/web/targeta.txt\0");
        } finally {
          await subscription.release();
        }
      } finally {
        // afterEach shuts down the daemon and its repository observers first.
        onTestFinished(() => rmSync(cwd, { recursive: true, force: true }));
      }
    },
  );
});

describe("file explorer", () => {
  test("lists directory contents", async () => {
    const cwd = tmpCwd();

    // Create test files and directories
    writeFileSync(path.join(cwd, "test.txt"), "hello world\n");
    writeFileSync(path.join(cwd, "data.json"), '{"key": "value"}\n');
    mkdirSync(path.join(cwd, "subdir"));
    writeFileSync(path.join(cwd, "subdir", "nested.txt"), "nested content\n");

    // Create agent in the directory
    const agent = await ctx.client.createAgent({
      provider: "codex",
      model: CODEX_TEST_MODEL,
      thinkingOptionId: CODEX_TEST_THINKING_OPTION_ID,
      cwd,
      title: "File Explorer Test",
    });

    expect(agent.id).toBeTruthy();
    expect(agent.status).toBe("idle");

    // List directory contents
    const directory = await ctx.client.listDirectory(cwd, ".");

    // Verify listing returned without error
    expect(directory.entries).toBeTruthy();

    // Find expected entries
    const entries = directory.entries;
    const testTxt = entries.find((e) => e.name === "test.txt");
    const dataJson = entries.find((e) => e.name === "data.json");
    const subdir = entries.find((e) => e.name === "subdir");

    expect(testTxt).toBeTruthy();
    expect(testTxt!.kind).toBe("file");
    expect(testTxt!.size).toBeGreaterThan(0);

    expect(dataJson).toBeTruthy();
    expect(dataJson!.kind).toBe("file");

    expect(subdir).toBeTruthy();
    expect(subdir!.kind).toBe("directory");

    // Cleanup
    await ctx.client.deleteAgent(agent.id);
    rmSync(cwd, { recursive: true, force: true });
  }, 60000); // 1 minute timeout

  test("reads file contents", async () => {
    const cwd = tmpCwd();
    const testContent = "This is test file content.\nLine 2.";
    const testFile = path.join(cwd, "readme.txt");
    writeFileSync(testFile, testContent);

    // Create agent in the directory
    const agent = await ctx.client.createAgent({
      provider: "codex",
      model: CODEX_TEST_MODEL,
      thinkingOptionId: CODEX_TEST_THINKING_OPTION_ID,
      cwd,
      title: "File Read Test",
    });

    expect(agent.id).toBeTruthy();

    // Read file contents
    const result = await ctx.client.readFile(cwd, "readme.txt");

    // Verify file read
    // Server may return basename or full path
    expect(result.path).toContain("readme.txt");
    expect(result.kind).toBe("text");
    expect(new TextDecoder().decode(result.bytes)).toBe(testContent);
    expect(result.size).toBe(testContent.length);

    // Cleanup
    await ctx.client.deleteAgent(agent.id);
    rmSync(cwd, { recursive: true, force: true });
  }, 60000); // 1 minute timeout

  test("returns error for non-existent path", async () => {
    const cwd = tmpCwd();

    // Create agent
    const agent = await ctx.client.createAgent({
      provider: "codex",
      model: CODEX_TEST_MODEL,
      thinkingOptionId: CODEX_TEST_THINKING_OPTION_ID,
      cwd,
      title: "File Explorer Error Test",
    });

    expect(agent.id).toBeTruthy();

    // Try to list non-existent path
    await expect(ctx.client.listDirectory(cwd, "does-not-exist")).rejects.toThrow();

    // Cleanup
    await ctx.client.deleteAgent(agent.id);
    rmSync(cwd, { recursive: true, force: true });
  }, 60000); // 1 minute timeout
});
