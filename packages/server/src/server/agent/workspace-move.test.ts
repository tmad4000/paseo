import { writeJsonFileAtomic } from "../atomic-file.js";
import { createWorkspaceProvisioningService } from "../session/workspace-provisioning/workspace-provisioning-service.js";
import { afterEach, describe, expect, test, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as flushTasks } from "node:timers/promises";
import { archiveByScope, type ArchiveDependencies } from "../workspace-archive-service.js";
import { createNoopWorkspaceGitService } from "../test-utils/workspace-git-service-stub.js";

import { assertWorkspaceAutomationAllowedForWorkspace } from "../workspace-automation-gate.js";
import { AgentStorage, type StoredAgentRecord } from "./agent-storage.js";
import { AgentManager } from "./agent-manager.js";
import { createTestLogger } from "../../test-utils/test-logger.js";
import { WorkspaceReconciliationService } from "../workspace-reconciliation-service.js";
import { runWorktreeSetupInBackground } from "../worktree-session.js";
import { archivePersistedWorkspaceRecord } from "../workspace-archive-service.js";
import type { MoveAgentWorkspaceDependencies, MoveAgentWorkspaceInput } from "./workspace-move.js";
import { moveAgentWorkspace, ASIDES_WORKSPACE_LABEL } from "./workspace-move.js";
import {
  createPersistedWorkspaceRecord,
  createPersistedProjectRecord,
  FileBackedWorkspaceRegistry,
  FileBackedProjectRegistry,
  type PersistedWorkspaceRecord,
  type WorkspaceRegistry,
} from "../workspace-registry.js";

const cleanupPaths: string[] = [];
afterEach(() => {
  for (const path of cleanupPaths.splice(0)) rmSync(path, { recursive: true, force: true });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function workspace(id: string): PersistedWorkspaceRecord {
  return createPersistedWorkspaceRecord({
    workspaceId: id,
    projectId: "project",
    cwd: "/repo/worktree",
    kind: "worktree",
    displayName: "topic",
    title: "Topic",
    isPaseoOwnedWorktree: true,
    worktreeRoot: "/repo/worktree",
    mainRepoRoot: "/repo",
    branch: "topic",
    createdAt: "2026-11-13T00:00:00.000Z",
    updatedAt: "2026-11-13T00:00:00.000Z",
  });
}
function harness() {
  const workspaces = new Map<string, PersistedWorkspaceRecord>([["source", workspace("source")]]);
  const registry: WorkspaceRegistry = {
    initialize: async () => {},
    existsOnDisk: async () => true,
    list: async () => [...workspaces.values()],
    get: async (id) => workspaces.get(id) ?? null,
    update: async (id, update) => {
      const before = workspaces.get(id);
      if (!before) return null;
      const after = update(before);
      workspaces.set(id, after);
      return after;
    },
    upsert: async (value) => {
      workspaces.set(value.workspaceId, value);
    },
    archive: async (id, archivedAt) => {
      const value = workspaces.get(id);
      if (value) workspaces.set(id, { ...value, archivedAt });
    },
    remove: async (id) => {
      workspaces.delete(id);
    },
  };
  const agent = {
    workspaceId: "source",
    cwd: "/repo/worktree",
    history: ["keep this"],
    id: "chat",
  };
  let creates = 0;
  const metadata = {
    getAgent: () => null,
    updateAgentMetadata: async (_id: string, patch: { workspaceId?: string }) => {
      if (patch.workspaceId) agent.workspaceId = patch.workspaceId;
    },
  };
  const deps: MoveAgentWorkspaceDependencies = {
    workspaceRegistry: registry,
    agentStorage: { get: async () => null },
    agentManager: {
      ...metadata,
      moveAgentToWorkspace: (id, patch) => metadata.updateAgentMetadata(id, patch),
    },
    projectRegistry: {
      list: async () => [],
      get: async () => ({
        projectId: "project",
        rootPath: "/repo",
        kind: "git",
        displayName: "Project",
        projectKey: null,
        customName: null,
        customIconRevision: null,
        archivedAt: null,
        createdAt: "",
        updatedAt: "",
      }),
    },
    workspaceProvisioning: {
      createWorkspaceForDirectory: async (cwd, title, projectId, context) => {
        creates += 1;
        const value = {
          ...workspace(context?.workspaceId ?? `created-${creates}`),
          cwd,
          projectId: projectId ?? "project",
          title: title ?? null,
          ...(context?.untrustedSource ? { untrustedSource: context.untrustedSource } : {}),
        };
        workspaces.set(value.workspaceId, value);
        return value;
      },
    },
  };
  // Use the stored-agent boundary without constructing a provider runtime.
  const record: StoredAgentRecord = {
    ...agent,
    provider: "codex",
    archivedAt: null,
    labels: {},
    lastStatus: "closed" as const,
    createdAt: "2026-11-13T00:00:00Z",
    updatedAt: "2026-11-13T00:00:00Z",
  };
  deps.agentStorage.get = async () => ({ ...record, workspaceId: agent.workspaceId });
  return { deps, agent, record, workspaces, creates: () => creates };
}

function archiveHarness(h: ReturnType<typeof harness>) {
  const events: string[] = [];
  for (const [id, value] of h.workspaces) {
    h.workspaces.set(id, {
      ...value,
      kind: "directory",
      isPaseoOwnedWorktree: false,
      mainRepoRoot: null,
    });
  }
  const manager = {
    ...h.deps.agentManager,
    listAgents: () => [],
    archiveAgent: async () => ({ archivedAt: "2026-11-13T00:00:00Z" }),
    archiveSnapshot: async () => {
      h.record.archivedAt = "2026-11-13T00:00:00Z";
      events.push("archive-chat");
      return { ...h.record, workspaceId: h.agent.workspaceId };
    },
  };
  const move = manager.moveAgentToWorkspace;
  manager.moveAgentToWorkspace = async (...args) => {
    if (h.record.archivedAt) throw new Error("Chat is unavailable or archived");
    await move(...args);
    events.push("move-chat");
  };
  h.deps.agentManager = manager;
  const deps: ArchiveDependencies = {
    agentManager: manager,
    agentStorage: {
      list: async () => [{ ...h.record, workspaceId: h.agent.workspaceId }],
      listByWorkspace: async (id) =>
        h.agent.workspaceId === id ? [{ ...h.record, workspaceId: id }] : [],
    },
    github: { invalidate: () => {} } as ArchiveDependencies["github"],
    workspaceGitService: createNoopWorkspaceGitService(),
    findWorkspaceIdForCwd: async () => null,
    getWorkspace: (id) => h.deps.workspaceRegistry.get(id),
    listActiveWorkspaces: async () =>
      [...h.workspaces.values()].filter((record) => !record.archivedAt),
    archiveWorkspaceRecord: async (id) => {
      await h.deps.workspaceRegistry.archive(id, "2026-11-13T00:00:00Z");
      events.push(`archive-${id}`);
    },
    emitWorkspaceUpdatesForWorkspaceIds: async () => {},
    markWorkspaceArchiving: () => {},
    clearWorkspaceArchiving: () => {},
    killTerminalsForWorkspace: async () => {},
  };
  return { deps, events };
}

async function persistedMoveHarness() {
  const root = mkdtempSync(join(tmpdir(), "move-background-"));
  cleanupPaths.push(root);
  const logger = createTestLogger();
  const workspaceWrites: PersistedWorkspaceRecord[][] = [];
  const workspaceRegistry = new FileBackedWorkspaceRegistry(join(root, "workspaces.json"), logger, {
    writeRecords: async (filePath, records) => {
      workspaceWrites.push([...records]);
      await writeJsonFileAtomic(filePath, records);
    },
  });
  const projectRegistry = new FileBackedProjectRegistry(join(root, "projects.json"), logger);
  const source = {
    ...workspace("source"),
    cwd: join(root, "source"),
    kind: "directory" as const,
    isPaseoOwnedWorktree: false,
    mainRepoRoot: null,
  };
  const destination = { ...source, workspaceId: "destination", cwd: join(root, "destination") };
  mkdirSync(source.cwd);
  mkdirSync(destination.cwd);
  await workspaceRegistry.upsert(source);
  await workspaceRegistry.upsert(destination);
  await projectRegistry.upsert(
    createPersistedProjectRecord({
      projectId: source.projectId,
      rootPath: root,
      kind: "non_git",
      displayName: "Project",
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
    }),
  );
  const agentStorage = new AgentStorage(join(root, "agents"), logger);
  const stub = harness();
  const record: StoredAgentRecord = {
    ...stub.record,
    cwd: source.cwd,
    persistence: { provider: "codex", sessionId: "retained-session" },
    labels: { "paseo.parent-agent-id": "parent" },
  };
  await agentStorage.upsert(record);
  const agentManager = new AgentManager({ clients: {}, registry: agentStorage, logger });
  const deps: MoveAgentWorkspaceDependencies = {
    workspaceRegistry,
    projectRegistry,
    agentStorage,
    agentManager,
    workspaceProvisioning: stub.deps.workspaceProvisioning,
  };
  const input: MoveAgentWorkspaceInput = {
    agentId: record.id,
    expectedWorkspaceId: source.workspaceId,
    destination: { kind: "existing", workspaceId: destination.workspaceId },
  };
  return {
    deps,
    input,
    source,
    destination,
    agentManager,
    agentStorage,
    workspaceRegistry,
    projectRegistry,
    logger,
    workspaceWrites,
  };
}

describe("move chat workspace", () => {
  test("moves the same conversation and retains worktree recovery metadata", async () => {
    const h = harness();
    const moved = await moveAgentWorkspace(h.deps, {
      agentId: "chat",
      expectedWorkspaceId: "source",
      destination: { kind: "new", title: "Aside", workspaceId: "wks_0000000000000001" },
    });
    expect(h.agent).toMatchObject({
      id: "chat",
      cwd: "/repo/worktree",
      history: ["keep this"],
      workspaceId: moved.workspaceId,
    });
    expect(moved).toMatchObject({
      title: "Aside",
      isPaseoOwnedWorktree: true,
      worktreeRoot: "/repo/worktree",
      branch: "topic",
    });
    await moveAgentWorkspace(h.deps, {
      agentId: "chat",
      expectedWorkspaceId: "source",
      destination: { kind: "new", title: "Aside", workspaceId: moved.workspaceId },
    });
    expect(h.creates()).toBe(1);
  });
  test("concurrent clients share one Asides workspace, even after it is renamed", async () => {
    const h = harness();
    const request = {
      agentId: "chat",
      expectedWorkspaceId: "source",
      destination: { kind: "asides" as const },
    };
    const [first, second] = await Promise.all([
      moveAgentWorkspace(h.deps, request),
      moveAgentWorkspace(h.deps, request),
    ]);
    expect(first.workspaceId).toBe(second.workspaceId);
    expect(h.creates()).toBe(1);
    expect(first.labels).toContain(ASIDES_WORKSPACE_LABEL);
    h.workspaces.set(first.workspaceId, { ...first, title: "Misc" });
    h.agent.workspaceId = "source";
    expect((await moveAgentWorkspace(h.deps, request)).title).toBe("Misc");
    expect(h.creates()).toBe(1);
  });
  test.each(["asides", "new"] as const)(
    "preserves automation restrictions when %s shares the source directory",
    async (kind) => {
      const h = harness();
      const source = h.workspaces.get("source")!;
      const untrustedSource = {
        kind: "change_request" as const,
        forge: "github",
        number: 42,
        headRepository: "contributor/repo",
      };
      h.workspaces.set("source", { ...source, untrustedSource });
      const create = h.deps.workspaceProvisioning.createWorkspaceForDirectory;
      let firstPublished: PersistedWorkspaceRecord | null = null;
      h.deps.workspaceProvisioning.createWorkspaceForDirectory = async (...args) => {
        const created = await create(...args);
        firstPublished = created;
        await expect(
          assertWorkspaceAutomationAllowedForWorkspace(
            h.deps.workspaceRegistry,
            created.workspaceId,
          ),
        ).rejects.toThrow("Scripts are blocked");
        return created;
      };
      const destination =
        kind === "new" ? { kind, title: "Aside", workspaceId: "wks_0000000000000001" } : { kind };
      const moved = await moveAgentWorkspace(h.deps, {
        agentId: "chat",
        expectedWorkspaceId: "source",
        destination,
      });
      expect(firstPublished).toMatchObject({ cwd: source.cwd, untrustedSource });
      expect(moved.untrustedSource).toEqual(untrustedSource);
      await expect(
        assertWorkspaceAutomationAllowedForWorkspace(h.deps.workspaceRegistry, moved.workspaceId),
      ).rejects.toThrow("Scripts are blocked");
    },
  );
  test("Asides uses a separate Default directory without inheriting the source block", async () => {
    const h = harness();
    h.workspaces.set("source", {
      ...workspace("source"),
      untrustedSource: {
        kind: "change_request",
        forge: "github",
        number: 42,
        headRepository: "contributor/repo",
      },
    });
    const project = await h.deps.projectRegistry.get("project");
    if (!project) throw new Error("Missing project fixture");
    h.deps.projectRegistry.list = async () => [
      { ...project, rootPath: "/default", defaultAt: "2026-11-13T00:00:00Z" },
    ];
    const moved = await moveAgentWorkspace(h.deps, {
      agentId: "chat",
      expectedWorkspaceId: "source",
      destination: { kind: "asides" },
    });
    expect(moved.cwd).toBe("/default");
    expect(moved.untrustedSource).toBeUndefined();
    await expect(
      assertWorkspaceAutomationAllowedForWorkspace(h.deps.workspaceRegistry, moved.workspaceId),
    ).resolves.toBeUndefined();
  });
  test("retains the automation block before publishing Asides through a Default directory alias", async () => {
    const h = harness();
    const root = mkdtempSync(join(tmpdir(), "move-alias-"));
    cleanupPaths.push(root);
    const cwd = join(root, "checkout");
    const alias = join(root, "alias");
    mkdirSync(cwd);
    symlinkSync(cwd, alias, process.platform === "win32" ? "junction" : "dir");
    const untrustedSource = {
      kind: "change_request" as const,
      forge: "github",
      number: 42,
      headRepository: "contributor/repo",
    };
    h.workspaces.set("source", { ...workspace("source"), cwd, untrustedSource });
    const project = await h.deps.projectRegistry.get("project");
    if (!project) throw new Error("Missing project fixture");
    h.deps.projectRegistry.list = async () => [
      { ...project, rootPath: alias, defaultAt: "2026-11-13T00:00:00Z" },
    ];
    const create = h.deps.workspaceProvisioning.createWorkspaceForDirectory;
    h.deps.workspaceProvisioning.createWorkspaceForDirectory = async (...args) => {
      const created = await create(...args);
      await expect(
        assertWorkspaceAutomationAllowedForWorkspace(h.deps.workspaceRegistry, created.workspaceId),
      ).rejects.toThrow("Scripts are blocked");
      return created;
    };
    const moved = await moveAgentWorkspace(h.deps, {
      agentId: "chat",
      expectedWorkspaceId: "source",
      destination: { kind: "asides" },
    });
    expect(moved).toMatchObject({ cwd: alias, untrustedSource });
  });

  test.each(["source", "destination"])(
    "serializes %s archive behind a paused move",
    async (target) => {
      const h = harness();
      h.workspaces.set("destination", workspace("destination"));
      const archive = archiveHarness(h);
      const entered = deferred();
      const release = deferred();
      const getProject = h.deps.projectRegistry.get;
      h.deps.projectRegistry.get = async (id) => {
        entered.resolve();
        await release.promise;
        return getProject(id);
      };
      const moving = moveAgentWorkspace(h.deps, {
        agentId: "chat",
        expectedWorkspaceId: "source",
        destination: { kind: "existing", workspaceId: "destination" },
      });
      await entered.promise;
      const archiving = archiveByScope(archive.deps, {
        scope: { kind: "workspace", workspaceId: target },
        requestId: "race",
      });
      await flushTasks();
      release.resolve();
      const [moved, archived] = await Promise.all([moving, archiving]);
      expect(moved.workspaceId).toBe("destination");
      expect(h.agent).toMatchObject({
        id: "chat",
        cwd: "/repo/worktree",
        history: ["keep this"],
        workspaceId: "destination",
      });
      expect(archived.archivedWorkspaceIds).toEqual([target]);
      expect(archived.archivedAgentIds).toEqual(target === "source" ? [] : ["chat"]);
      expect(h.record.archivedAt).toBe(target === "source" ? null : "2026-11-13T00:00:00Z");
      expect(archive.events[0]).toBe("move-chat");
    },
  );

  test.each(["source", "destination"])(
    "rejects a move queued behind %s archive",
    async (target) => {
      const h = harness();
      h.workspaces.set("destination", workspace("destination"));
      const archive = archiveHarness(h);
      const entered = deferred();
      const release = deferred();
      archive.deps.stopWorkspaceSetup = async () => {
        entered.resolve();
        await release.promise;
      };
      const archiving = archiveByScope(archive.deps, {
        scope: { kind: "workspace", workspaceId: target },
        requestId: "race",
      });
      await entered.promise;
      const moving = moveAgentWorkspace(h.deps, {
        agentId: "chat",
        expectedWorkspaceId: "source",
        destination: { kind: "existing", workspaceId: "destination" },
      });
      const rejected = expect(moving).rejects.toThrow(
        target === "source" ? "archived" : "Destination workspace is archived",
      );
      release.resolve();
      await Promise.all([archiving, rejected]);
      expect(h.agent.workspaceId).toBe("source");
      expect(archive.events).not.toContain("move-chat");
    },
  );

  test.each([
    ["reconciliation", "source"],
    ["reconciliation", "destination"],
    ["setup failure", "source"],
    ["setup failure", "destination"],
    ["removal", "source"],
    ["removal", "destination"],
  ] as const)(
    "rejects placement after background %s affects %s while waiting for the lifecycle lane",
    async (background, targetId) => {
      const h = await persistedMoveHarness();
      const entered = deferred();
      const release = deferred();
      const waiting = deferred();
      const blocking = h.agentManager.runLifecycleMutation(h.input.agentId, async () => {
        entered.resolve();
        await release.promise;
      });
      await entered.promise;
      const move = h.agentManager.moveAgentToWorkspace.bind(h.agentManager);
      vi.spyOn(h.agentManager, "moveAgentToWorkspace").mockImplementation((id, input) => {
        const result = move(id, input);
        waiting.resolve();
        return result;
      });
      const before = await h.agentStorage.get(h.input.agentId);
      const moving = moveAgentWorkspace(h.deps, h.input);
      const rejected = expect(moving).rejects.toThrow(
        targetId === "source"
          ? "Source workspace is unavailable"
          : "Destination workspace is unavailable or archived",
      );
      await waiting.promise;
      const target = targetId === "source" ? h.source : h.destination;
      try {
        if (background === "reconciliation") {
          rmSync(target.cwd, { recursive: true });
          const reconciliation = new WorkspaceReconciliationService({
            workspaceRegistry: h.workspaceRegistry,
            projectRegistry: h.projectRegistry,
            logger: h.logger,
            workspaceGitService: createNoopWorkspaceGitService(),
          });
          const result = await reconciliation.runOnce();
          expect(result.changesApplied).toContainEqual(
            expect.objectContaining({
              kind: "workspace_archived",
              workspaceId: targetId,
              reason: "directory_missing",
            }),
          );
        } else if (background === "setup failure") {
          writeFileSync(join(target.cwd, "paseo.json"), "{ invalid json");
          const statuses: string[] = [];
          await runWorktreeSetupInBackground(
            {
              emitWorkspaceUpdateForWorkspaceId: async () => {},
              cacheWorkspaceSetupSnapshot: (_id, snapshot) => {
                statuses.push(snapshot.status);
              },
              emit: () => {},
              sessionLogger: h.logger,
              terminalManager: null,
              archiveWorkspaceRecord: async (workspaceId) => {
                await archivePersistedWorkspaceRecord({
                  workspaceRegistry: h.workspaceRegistry,
                  workspaceId,
                });
              },
            },
            {
              requestCwd: target.cwd,
              repoRoot: target.cwd,
              workspaceId: targetId,
              worktree: { branchName: "topic", worktreePath: target.cwd },
              shouldBootstrap: true,
              slug: "topic",
              worktreePath: target.cwd,
            },
          );
          expect(statuses).toEqual(["running", "failed"]);
        } else {
          await h.workspaceRegistry.remove(targetId);
        }
        if (background === "removal") expect(await h.workspaceRegistry.get(targetId)).toBeNull();
        else
          expect((await h.workspaceRegistry.get(targetId))?.archivedAt).toEqual(expect.any(String));
      } finally {
        release.resolve();
      }
      await Promise.all([blocking, rejected]);
      expect(await h.agentStorage.get(h.input.agentId)).toEqual(before);
    },
  );

  test.each(["archive", "remove", "update", "upsert"] as const)(
    "registry %s waits until a placement commit releases the write boundary",
    async (mutation) => {
      const h = await persistedMoveHarness();
      const entered = deferred();
      const release = deferred();
      const events: string[] = [];
      const upsert = h.agentStorage.upsert.bind(h.agentStorage);
      vi.spyOn(h.agentStorage, "upsert").mockImplementation(async (record) => {
        if (record.workspaceId === h.destination.workspaceId) {
          entered.resolve();
          await release.promise;
        }
        await upsert(record);
        events.push("placement");
      });
      const moving = moveAgentWorkspace(h.deps, h.input);
      await entered.promise;
      const archived = { ...h.destination, archivedAt: "2026-11-13T01:00:00Z" };
      const operations = {
        archive: () => h.workspaceRegistry.archive(archived.workspaceId, archived.archivedAt),
        remove: () => h.workspaceRegistry.remove(archived.workspaceId),
        update: () => h.workspaceRegistry.update(archived.workspaceId, () => archived),
        upsert: () => h.workspaceRegistry.upsert(archived),
      };
      const writesBeforeMutation = h.workspaceWrites.length;
      const changing = operations[mutation]().then(() => {
        events.push("workspace");
        return undefined;
      });
      try {
        await flushTasks();
        expect(events).toEqual([]);
        expect(h.workspaceWrites).toHaveLength(writesBeforeMutation);
      } finally {
        release.resolve();
      }
      await Promise.all([moving, changing]);
      expect(events).toEqual(["placement", "workspace"]);
      expect((await h.agentStorage.get(h.input.agentId))?.workspaceId).toBe(
        h.destination.workspaceId,
      );
    },
  );

  test.each(["archive", "remove"] as const)(
    "does not republish a new destination after background %s",
    async (mutation) => {
      const h = await persistedMoveHarness();
      const entered = deferred();
      const release = deferred();
      const workspaceId = "wks_0000000000000002";
      const provisioning = createWorkspaceProvisioningService({
        workspaceRegistry: h.workspaceRegistry,
        projectRegistry: h.projectRegistry,
        workspaceGitService: createNoopWorkspaceGitService(),
        isDirectory: async () => true,
        logger: h.logger,
      });
      h.deps.workspaceProvisioning = {
        createWorkspaceForDirectory: async (...args) => {
          const created = await provisioning.createWorkspaceForDirectory(...args);
          entered.resolve();
          await release.promise;
          return created;
        },
      };
      const moving = moveAgentWorkspace(h.deps, {
        ...h.input,
        destination: { kind: "new", title: "New", workspaceId },
      });
      const rejected = expect(moving).rejects.toThrow(
        "Destination workspace is unavailable or archived",
      );
      await entered.promise;
      try {
        if (mutation === "archive")
          await h.workspaceRegistry.archive(workspaceId, "2026-11-13T01:00:00Z");
        else await h.workspaceRegistry.remove(workspaceId);
      } finally {
        release.resolve();
      }
      await rejected;
      if (mutation === "archive")
        expect((await h.workspaceRegistry.get(workspaceId))?.archivedAt).toBe(
          "2026-11-13T01:00:00Z",
        );
      else expect(await h.workspaceRegistry.get(workspaceId)).toBeNull();
      expect((await h.agentStorage.get(h.input.agentId))?.workspaceId).toBe(h.source.workspaceId);
    },
  );

  test("rejects an archived target and a stale source without moving the chat", async () => {
    const h = harness();
    h.workspaces.set("archived", { ...workspace("archived"), archivedAt: "2026-11-13T00:00:00Z" });
    await expect(
      moveAgentWorkspace(h.deps, {
        agentId: "chat",
        expectedWorkspaceId: "source",
        destination: { kind: "existing", workspaceId: "archived" },
      }),
    ).rejects.toThrow("archived");
    h.agent.workspaceId = "elsewhere";
    await expect(
      moveAgentWorkspace(h.deps, {
        agentId: "chat",
        expectedWorkspaceId: "source",
        destination: { kind: "asides" },
      }),
    ).rejects.toThrow("already moved");
    expect(h.creates()).toBe(0);
  });
});
