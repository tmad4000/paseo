import { describe, expect, test } from "vitest";
import type { MoveAgentWorkspaceDependencies } from "./workspace-move.js";
import { moveAgentWorkspace, ASIDES_WORKSPACE_LABEL } from "./workspace-move.js";
import {
  createPersistedWorkspaceRecord,
  type PersistedWorkspaceRecord,
  type WorkspaceRegistry,
} from "../workspace-registry.js";

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
  const deps: MoveAgentWorkspaceDependencies = {
    workspaceRegistry: registry,
    agentStorage: { get: async () => null },
    agentManager: {
      getAgent: () => null,
      updateAgentMetadata: async (_id, patch) => {
        if (patch.workspaceId) agent.workspaceId = patch.workspaceId;
      },
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
        };
        workspaces.set(value.workspaceId, value);
        return value;
      },
    },
  };
  // Use the stored-agent boundary without constructing a provider runtime.
  const record = {
    ...agent,
    provider: "codex",
    archivedAt: null,
    labels: {},
    lastStatus: "closed" as const,
    createdAt: "2026-11-13T00:00:00Z",
    updatedAt: "2026-11-13T00:00:00Z",
  };
  deps.agentStorage.get = async () => ({ ...record, workspaceId: agent.workspaceId });
  return { deps, agent, workspaces, creates: () => creates };
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
