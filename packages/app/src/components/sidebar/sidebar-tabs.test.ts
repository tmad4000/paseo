import { describe, expect, it } from "vitest";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import type { Agent } from "@/stores/session-store";
import type { SplitNode, WorkspaceLayout } from "@/stores/workspace-layout-actions";
import type { WorkspaceTab, WorkspaceTabTarget } from "@/workspace-tabs/model";
import { buildDeterministicWorkspaceTabId } from "@/workspace-tabs/identity";
import { buildSidebarTabRows, sidebarTabMeta } from "./sidebar-tabs";

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

function tab(tabId: string, target: WorkspaceTabTarget): WorkspaceTab {
  return { tabId, target, createdAt: 0 };
}

// The layout store keeps each pane's tabs on the pane; the public `SplitPane` type leaves them off.
function paneNode(id: string, tabs: WorkspaceTab[]): SplitNode {
  const pane = { id, tabIds: tabs.map((entry) => entry.tabId), focusedTabId: null, tabs };
  return { kind: "pane", pane };
}

function layoutOf(...panes: SplitNode[]): WorkspaceLayout {
  if (panes.length === 1) return { root: panes[0]!, focusedPaneId: "main" };
  return {
    root: {
      kind: "group",
      group: {
        id: "group",
        direction: "horizontal",
        children: panes,
        sizes: panes.map(() => 1 / panes.length),
      },
    },
    focusedPaneId: "main",
  };
}

describe("buildSidebarTabRows", () => {
  it("lists every tab of each workspace in workspace order, then pane order", () => {
    const rows = buildSidebarTabRows({
      hosts: [],
      workspaces: [makeWorkspace("ws-b"), makeWorkspace("ws-a")],
      layoutByWorkspace: {
        "srv:ws-a": layoutOf(
          paneNode("main", [
            tab("agent-1", { kind: "agent", agentId: "a1" }),
            tab("term-1", { kind: "terminal", terminalId: "t1" }),
          ]),
          paneNode("side", [tab("browser-1", { kind: "browser", browserId: "b1" })]),
        ),
        "srv:ws-b": layoutOf(
          paneNode("main", [tab("file-1", { kind: "file", path: "README.md" })]),
        ),
      },
    });

    expect(rows.map((row) => [row.workspaceId, row.tab.tabId, row.tab.kind])).toEqual([
      ["ws-b", "file-1", "file"],
      ["ws-a", "agent-1", "agent"],
      ["ws-a", "term-1", "terminal"],
      ["ws-a", "browser-1", "browser"],
    ]);
    expect(rows.every((row) => row.source === "layout")).toBe(true);
  });

  it("leaves out empty new-tab placeholders", () => {
    const rows = buildSidebarTabRows({
      hosts: [],
      workspaces: [makeWorkspace("ws-a")],
      layoutByWorkspace: {
        "srv:ws-a": layoutOf(
          paneNode("main", [
            tab("new", { kind: "new_tab" }),
            tab("term-1", { kind: "terminal", terminalId: "t1" }),
          ]),
        ),
      },
    });

    expect(rows.map((row) => row.tab.tabId)).toEqual(["term-1"]);
  });

  it("skips workspaces the filters removed, even when their layout is known", () => {
    const rows = buildSidebarTabRows({
      hosts: [],
      workspaces: [makeWorkspace("ws-a")],
      layoutByWorkspace: {
        "srv:ws-a": layoutOf(paneNode("main", [tab("t", { kind: "terminal", terminalId: "1" })])),
        "srv:ws-hidden": layoutOf(
          paneNode("main", [tab("h", { kind: "terminal", terminalId: "2" })]),
        ),
      },
    });

    expect(rows.map((row) => row.workspaceId)).toEqual(["ws-a"]);
  });

  it("falls back to top-level chats, oldest first, for a workspace never laid out here", () => {
    const agents = new Map(
      [
        makeAgent({ id: "newer", createdAt: at(5) }),
        makeAgent({ id: "older", createdAt: at(1) }),
        makeAgent({ id: "archived", archivedAt: at(2) }),
        makeAgent({ id: "elsewhere", workspaceId: "ws-other" }),
        makeAgent({ id: "child", parentAgentId: "older" }),
      ].map((agent) => [agent.id, agent]),
    );

    const rows = buildSidebarTabRows({
      hosts: [{ serverId: "srv", agents }],
      workspaces: [makeWorkspace("ws-a")],
      layoutByWorkspace: {},
    });

    expect(rows.map((row) => row.tab.target)).toEqual([
      { kind: "agent", agentId: "older" },
      { kind: "agent", agentId: "newer" },
    ]);
    expect(rows[0]!.tab.tabId).toBe(
      buildDeterministicWorkspaceTabId({ kind: "agent", agentId: "older" }),
    );
    expect(rows.every((row) => row.source === "agents")).toBe(true);
  });

  it("keys rows by workspace so the same tab id in two workspaces stays distinct", () => {
    const sameTab = () =>
      layoutOf(paneNode("main", [tab("terminal", { kind: "terminal", terminalId: "x" })]));
    const rows = buildSidebarTabRows({
      hosts: [],
      workspaces: [makeWorkspace("ws-a"), makeWorkspace("ws-a", { serverId: "other" })],
      layoutByWorkspace: { "srv:ws-a": sameTab(), "other:ws-a": sameTab() },
    });

    expect(new Set(rows.map((row) => row.key)).size).toBe(2);
  });
});

describe("sidebarTabMeta", () => {
  it("names the project, the workspace when it differs, and the host when given", () => {
    expect(sidebarTabMeta({ projectName: "paseo", workspaceName: "paseo" }, null)).toBe("paseo");
    expect(sidebarTabMeta({ projectName: "paseo", workspaceName: "fix-bug" }, "m4")).toBe(
      "paseo · fix-bug · m4",
    );
  });
});
