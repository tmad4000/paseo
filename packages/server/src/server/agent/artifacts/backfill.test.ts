import { mkdtemp, mkdir, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AgentArtifactCollector } from "./collector.js";

async function makeWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "paseo-artifact-backfill-"));
  await writeFile(path.join(root, "report.html"), "<h1>report</h1>");
  await writeFile(path.join(root, "notes.md"), "# notes");
  await writeFile(path.join(root, "diagram.svg"), "<svg/>");
  await writeFile(path.join(root, "main.ts"), "export const x = 1;");

  await mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
  await writeFile(path.join(root, "node_modules", "pkg", "readme.md"), "# vendored");

  await mkdir(path.join(root, ".git"), { recursive: true });
  await writeFile(path.join(root, ".git", "COMMIT_EDITMSG.md"), "# internal");

  return root;
}

describe("artifact backfill", () => {
  it("finds pre-existing files that no turn ever observed", async () => {
    const cwd = await makeWorkspace();
    const collector = new AgentArtifactCollector();

    // No beginTurn/finishTurn: this is the case the turn-scoped collector
    // cannot see at all.
    const result = await collector.scanExisting(cwd, []);

    expect(result).not.toBeNull();
    const paths = result?.artifacts.map((artifact) => artifact.path).sort();
    expect(paths).toEqual(["diagram.svg", "notes.md", "report.html"]);
    expect(result?.addedOrUpdated).toBe(3);
  });

  it("skips vendored and VCS directories", async () => {
    const cwd = await makeWorkspace();
    const result = await new AgentArtifactCollector().scanExisting(cwd, []);

    const paths = result?.artifacts.map((artifact) => artifact.path) ?? [];
    expect(paths.some((p) => p.includes("node_modules"))).toBe(false);
    expect(paths.some((p) => p.includes(".git"))).toBe(false);
  });

  it("classifies each artifact by extension", async () => {
    const cwd = await makeWorkspace();
    const result = await new AgentArtifactCollector().scanExisting(cwd, []);

    const byPath = new Map(result?.artifacts.map((a) => [a.path, a]) ?? []);
    expect(byPath.get("report.html")?.kind).toBe("html");
    expect(byPath.get("report.html")?.mimeType).toBe("text/html");
    expect(byPath.get("notes.md")?.kind).toBe("markdown");
    expect(byPath.get("diagram.svg")?.kind).toBe("svg");
    expect(byPath.get("report.html")?.size).toBeGreaterThan(0);
  });

  it("keeps the newest when the limit is smaller than the match count", async () => {
    const cwd = await makeWorkspace();
    // Age report.html so it is unambiguously the oldest of the three.
    const old = new Date(Date.now() - 1000 * 60 * 60 * 24);
    await utimes(path.join(cwd, "report.html"), old, old);

    const result = await new AgentArtifactCollector().scanExisting(cwd, [], { limit: 2 });

    expect(result?.artifacts).toHaveLength(2);
    expect(result?.artifacts.map((a) => a.path)).not.toContain("report.html");
  });

  it("reports nothing to do when every artifact is already recorded", async () => {
    const cwd = await makeWorkspace();
    const collector = new AgentArtifactCollector();
    const first = await collector.scanExisting(cwd, []);
    expect(first).not.toBeNull();

    const second = await collector.scanExisting(cwd, first?.artifacts ?? []);

    // A second pass over unchanged files must not churn the agent record.
    expect(second).toBeNull();
  });
});
