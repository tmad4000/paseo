import os from "node:os";
import path from "node:path";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { createTestLogger } from "../test-utils/test-logger.js";
import { setProjectDefault, setProjectPinned } from "./project-pins.js";
import { createPersistedProjectRecord, FileBackedProjectRegistry } from "./workspace-registry.js";

function project(projectId: string, extra: { defaultAt?: string; pinnedAt?: string } = {}) {
  return createPersistedProjectRecord({
    projectId,
    rootPath: `/tmp/${projectId}`,
    kind: "non_git",
    displayName: projectId,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...extra,
  });
}

describe("project pins and the Default project", () => {
  let tmpDir: string;
  let filePath: string;
  let registry: FileBackedProjectRegistry;

  beforeEach(async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "project-pins-"));
    filePath = path.join(tmpDir, "projects", "projects.json");
    registry = new FileBackedProjectRegistry(filePath, createTestLogger());
    await registry.initialize();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("reads project records written before pinning existed", async () => {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(
      filePath,
      JSON.stringify([
        {
          projectId: "prj_old",
          rootPath: "/tmp/old",
          kind: "non_git",
          displayName: "old",
          projectKey: null,
          customName: null,
          customIconRevision: null,
          createdAt: "2026-08-19T05:12:44.724Z",
          updatedAt: "2026-09-28T07:02:32.083Z",
          archivedAt: null,
        },
      ]),
    );
    const fresh = new FileBackedProjectRegistry(filePath, createTestLogger());
    const record = await fresh.get("prj_old");
    expect(record?.pinnedAt ?? null).toBeNull();
    expect(record?.defaultAt ?? null).toBeNull();
  });

  test("pins, keeps the first pin time on repeat, and unpins", async () => {
    await registry.upsert(project("a"));

    const pinned = await setProjectPinned({
      registry,
      projectId: "a",
      pinned: true,
      now: "2026-10-10T10:00:00.000Z",
    });
    expect(pinned?.pinnedAt).toBe("2026-10-10T10:00:00.000Z");

    const repeated = await setProjectPinned({
      registry,
      projectId: "a",
      pinned: true,
      now: "2026-10-10T11:00:00.000Z",
    });
    expect(repeated?.pinnedAt).toBe("2026-10-10T10:00:00.000Z");

    const unpinned = await setProjectPinned({
      registry,
      projectId: "a",
      pinned: false,
      now: "2026-10-10T12:00:00.000Z",
    });
    expect(unpinned?.pinnedAt).toBeNull();
    const persisted = JSON.parse(readFileSync(filePath, "utf8")) as Array<{ pinnedAt?: unknown }>;
    expect(persisted[0]?.pinnedAt).toBeNull();
  });

  test("reports a missing project", async () => {
    expect(
      await setProjectPinned({ registry, projectId: "missing", pinned: true, now: "x" }),
    ).toBeNull();
    expect(
      await setProjectDefault({ registry, projectId: "missing", isDefault: true, now: "x" }),
    ).toEqual({ project: null, changed: [] });
  });

  test("setting a default clears the previous default and leaves pins alone", async () => {
    await registry.upsert(project("a", { defaultAt: "2026-10-01T00:00:00.000Z" }));
    await registry.upsert(project("b", { pinnedAt: "2026-10-02T00:00:00.000Z" }));

    const result = await setProjectDefault({
      registry,
      projectId: "b",
      isDefault: true,
      now: "2026-10-10T10:00:00.000Z",
    });

    expect(result.project?.defaultAt).toBe("2026-10-10T10:00:00.000Z");
    expect(result.changed.map((record) => record.projectId)).toEqual(["b", "a"]);
    expect((await registry.get("a"))?.defaultAt).toBeNull();
    expect((await registry.get("b"))?.pinnedAt).toBe("2026-10-02T00:00:00.000Z");
  });

  test("concurrent defaults from two devices leave exactly one default", async () => {
    await registry.upsert(project("a"));
    await registry.upsert(project("b"));
    await registry.upsert(project("c", { defaultAt: "2026-10-01T00:00:00.000Z" }));

    await Promise.all([
      setProjectDefault({
        registry,
        projectId: "a",
        isDefault: true,
        now: "2026-10-10T10:00:00.000Z",
      }),
      setProjectDefault({
        registry,
        projectId: "b",
        isDefault: true,
        now: "2026-10-10T10:00:00.001Z",
      }),
    ]);

    const defaults = (await registry.list()).filter((record) => record.defaultAt);
    expect(defaults.map((record) => record.projectId)).toEqual(["b"]);
    const reloaded = new FileBackedProjectRegistry(filePath, createTestLogger());
    const persistedDefaults = (await reloaded.list()).filter((record) => record.defaultAt);
    expect(persistedDefaults.map((record) => record.projectId)).toEqual(["b"]);
  });

  test("removing the default clears only that project", async () => {
    await registry.upsert(project("a", { defaultAt: "2026-10-01T00:00:00.000Z" }));
    await registry.upsert(project("b"));

    const result = await setProjectDefault({
      registry,
      projectId: "a",
      isDefault: false,
      now: "2026-10-10T10:00:00.000Z",
    });

    expect(result.project?.defaultAt).toBeNull();
    expect(result.changed.map((record) => record.projectId)).toEqual(["a"]);
    expect((await registry.get("b"))?.defaultAt ?? null).toBeNull();
  });

  test("re-setting the current default is a no-op that keeps its timestamp", async () => {
    await registry.upsert(project("a", { defaultAt: "2026-10-01T00:00:00.000Z" }));

    const result = await setProjectDefault({
      registry,
      projectId: "a",
      isDefault: true,
      now: "2026-10-10T10:00:00.000Z",
    });

    expect(result.project?.defaultAt).toBe("2026-10-01T00:00:00.000Z");
    expect(result.changed).toEqual([]);
  });
});
