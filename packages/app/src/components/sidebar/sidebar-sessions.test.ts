import { describe, expect, it } from "vitest";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { SESSION_PIN_LABEL } from "@/session-pins/model";
import type { Agent } from "@/stores/session-store";
import { buildSidebarSessionRows, sidebarSessionMeta } from "./sidebar-sessions";

const T0 = new Date("2026-10-01T10:00:00.000Z");

function at(minutes: number): Date {
  return new Date(T0.getTime() + minutes * 60_000);
}

function makeAgent(input: Partial<Agent> & Pick<Agent, "id">): Agent {
  return {
    serverId: "srv",
    provider: "claude",
    status: "idle",
    turn: { phase: "idle", cancellationRequestId: null },
    createdAt: T0,
    updatedAt: T0,
    lastUserMessageAt: null,
    lastActivityAt: T0,
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    },
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    runtimeInfo: undefined,
    lastUsage: undefined,
    lastError: null,
    title: input.id,
    cwd: "/repo",
    model: null,
    features: undefined,
    thinkingOptionId: undefined,
    requiresAttention: false,
    attentionReason: null,
    attentionTimestamp: null,
    archivedAt: null,
    parentAgentId: null,
    labels: {},
    projectPlacement: null,
    workspaceId: "ws-a",
    ...input,
  };
}

function activity(user: Date | null, assistant: Date | null): Agent["messageActivity"] {
  return {
    lastUserMessageAt: user?.toISOString() ?? null,
    lastAssistantMessageAt: assistant?.toISOString() ?? null,
  } as Agent["messageActivity"];
}

function makeWorkspace(
  workspaceId: string,
  options: { serverId?: string; projectName?: string; name?: string } = {},
): SidebarWorkspaceEntry {
  const serverId = options.serverId ?? "srv";
  return {
    workspaceKey: `${serverId}:${workspaceId}`,
    serverId,
    workspaceId,
    projectViewKey: options.projectName ?? "paseo",
    projectName: options.projectName ?? "paseo",
    projectKind: "git",
    workspaceKind: "worktree",
    name: options.name ?? workspaceId,
    workspaceDirectory: "",
    workspaceDirectoryLabel: "",
    title: null,
    currentBranch: null,
    statusBucket: "done",
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: null,
    prHint: null,
    archiveHasUncommittedChanges: null,
    archiveUnpushedCommitCount: null,
    scripts: [],
    hasRunningScripts: false,
  };
}

function agents(...list: Agent[]): Map<string, Agent> {
  return new Map(list.map((agent) => [agent.id, agent]));
}

const workspaces = [makeWorkspace("ws-a"), makeWorkspace("ws-b", { projectName: "docs" })];

describe("buildSidebarSessionRows", () => {
  it("lists top-level chats across hosts by latest conversation activity", () => {
    const rows = buildSidebarSessionRows({
      hosts: [
        {
          serverId: "srv",
          agents: agents(
            makeAgent({ id: "old", messageActivity: activity(at(1), at(2)) }),
            makeAgent({ id: "new", workspaceId: "ws-b", messageActivity: activity(at(5), null) }),
          ),
        },
        {
          serverId: "other",
          agents: agents(
            makeAgent({ id: "mid", serverId: "other", messageActivity: activity(null, at(3)) }),
          ),
        },
      ],
      workspaces: [...workspaces, makeWorkspace("ws-a", { serverId: "other" })],
      query: "",
      sortMode: "recent",
    });
    expect(rows.map((row) => row.agentId)).toEqual(["new", "mid", "old"]);
    expect(rows[0]).toMatchObject({ projectName: "docs", workspaceName: "ws-b" });
    expect(rows[1]).toMatchObject({ serverId: "other", workspaceKey: "other:ws-a" });
  });

  it("excludes archived, subagent, pinned and out-of-scope chats", () => {
    const rows = buildSidebarSessionRows({
      hosts: [
        {
          serverId: "srv",
          agents: agents(
            makeAgent({ id: "keep" }),
            makeAgent({ id: "archived", archivedAt: at(1) }),
            makeAgent({ id: "child", parentAgentId: "keep" }),
            makeAgent({ id: "pinned", labels: { [SESSION_PIN_LABEL]: at(1).toISOString() } }),
            makeAgent({ id: "filtered-out", workspaceId: "ws-hidden" }),
            makeAgent({ id: "no-workspace", workspaceId: undefined }),
          ),
        },
      ],
      workspaces,
      query: "",
      sortMode: "recent",
    });
    expect(rows.map((row) => row.agentId)).toEqual(["keep"]);
  });

  it("filters by session title, ignoring case and project names", () => {
    const rows = buildSidebarSessionRows({
      hosts: [
        {
          serverId: "srv",
          agents: agents(
            makeAgent({ id: "a", title: "Fix Login bug" }),
            makeAgent({ id: "b", title: "Write docs", workspaceId: "ws-b" }),
            makeAgent({ id: "c", title: null }),
          ),
        },
      ],
      workspaces,
      query: "login",
      sortMode: "recent",
    });
    expect(rows.map((row) => row.agentId)).toEqual(["a"]);
    const byProject = buildSidebarSessionRows({
      hosts: [{ serverId: "srv", agents: agents(makeAgent({ id: "b", workspaceId: "ws-b" })) }],
      workspaces,
      query: "docs",
      sortMode: "recent",
    });
    expect(byProject).toEqual([]);
  });

  it("honours the other sort modes", () => {
    const list = agents(
      makeAgent({
        id: "b",
        title: "beta",
        createdAt: at(2),
        messageActivity: activity(at(9), at(1)),
      }),
      makeAgent({
        id: "a",
        title: "Alpha",
        createdAt: at(3),
        messageActivity: activity(at(1), at(8)),
      }),
      makeAgent({ id: "c", title: "gamma", createdAt: at(1), workspaceId: "ws-b" }),
    );
    const order = (sortMode: Parameters<typeof buildSidebarSessionRows>[0]["sortMode"]) =>
      buildSidebarSessionRows({
        hosts: [{ serverId: "srv", agents: list }],
        workspaces,
        query: "",
        sortMode,
      }).map((row) => row.agentId);
    expect(order("user")).toEqual(["b", "a", "c"]);
    expect(order("assistant")).toEqual(["a", "b", "c"]);
    expect(order("started")).toEqual(["a", "b", "c"]);
    expect(order("title")).toEqual(["a", "b", "c"]);
    // Manual follows workspace order, then each workspace's chats oldest first.
    expect(order("manual")).toEqual(["b", "a", "c"]);
  });

  it("shows the start date under Date started and last activity otherwise", () => {
    const list = agents(
      makeAgent({ id: "a", createdAt: at(1), messageActivity: activity(at(4), null) }),
    );
    const [started] = buildSidebarSessionRows({
      hosts: [{ serverId: "srv", agents: list }],
      workspaces,
      query: "",
      sortMode: "started",
    });
    const [recent] = buildSidebarSessionRows({
      hosts: [{ serverId: "srv", agents: list }],
      workspaces,
      query: "",
      sortMode: "recent",
    });
    expect(started?.displayAt).toEqual(at(1));
    expect(recent?.displayAt).toEqual(at(4));
  });

  it("derives each row's status from its own chat", () => {
    const [row] = buildSidebarSessionRows({
      hosts: [
        {
          serverId: "srv",
          agents: agents(
            makeAgent({ id: "a", requiresAttention: true, attentionReason: "permission" }),
          ),
        },
      ],
      workspaces,
      query: "",
      sortMode: "recent",
    });
    expect(row?.statusBucket).toBe("needs_input");
  });
});

describe("sidebarSessionMeta", () => {
  it("names project and workspace, and the host only when given", () => {
    expect(sidebarSessionMeta({ projectName: "paseo", workspaceName: "main" }, null)).toBe(
      "paseo · main",
    );
    expect(sidebarSessionMeta({ projectName: "paseo", workspaceName: "main" }, "SDMM770")).toBe(
      "paseo · main · SDMM770",
    );
    expect(sidebarSessionMeta({ projectName: "paseo", workspaceName: "paseo" }, null)).toBe(
      "paseo",
    );
  });
});
