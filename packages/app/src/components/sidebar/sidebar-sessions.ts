import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { sessionPinnedAt } from "@/session-pins/model";
import type { Agent } from "@/stores/session-store";
import { isWorkspaceRootAgent } from "@/subagents/policies";
import { deriveSidebarStateBucket, type SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { agentMessageTimestamps, workspaceAgentStatus } from "@/utils/workspace-agent-activity";
import type { SidebarSortMode } from "./sidebar-filter-sort";

/**
 * One row of Sessions grouping: a top-level chat, wherever it lives. The sidebar shows these
 * instead of workspaces below the pinned section (docs/sidebar-sorting.md#sessions-grouping).
 */
export interface SidebarSessionRow {
  key: string;
  serverId: string;
  agentId: string;
  workspaceId: string;
  workspaceKey: string;
  provider: string;
  /** The chat's own title; null until the host names it. */
  title: string | null;
  projectName: string;
  workspaceName: string;
  statusBucket: SidebarStateBucket;
  /** The sort's clock: when the row last moved under `recent`/`user`/`assistant`, or its start. */
  sortAt: Date;
  /** What the trailing timestamp shows: the start date under `started`, else last activity. */
  displayAt: Date;
}

export interface SidebarSessionHostAgents {
  serverId: string;
  agents: ReadonlyMap<string, Agent> | undefined;
}

export interface BuildSidebarSessionRowsInput {
  hosts: readonly SidebarSessionHostAgents[];
  /**
   * The workspaces the host, project and label filters leave, in the sidebar's own order. A
   * session shows only when its workspace is here, so every filter above the text query applies
   * to sessions the same way it applies to workspaces.
   */
  workspaces: readonly SidebarWorkspaceEntry[];
  /** Normalized find-field text (`normalizeSidebarQuery`); empty shows every session. */
  query: string;
  sortMode: SidebarSortMode;
}

export function sidebarSessionKey(serverId: string, agentId: string): string {
  return JSON.stringify([serverId, agentId]);
}

/**
 * Every unarchived top-level chat in the visible workspaces, across hosts, in the chosen sort.
 * Pinned sessions stay in their own section above, so they are left out here; subagent chats
 * stay under their parent. Manual order follows the workspaces' order, then each workspace's
 * chats oldest first, since chats have no arrangement of their own.
 */
export function buildSidebarSessionRows(input: BuildSidebarSessionRowsInput): SidebarSessionRow[] {
  const workspaceByKey = new Map<string, { entry: SidebarWorkspaceEntry; index: number }>();
  input.workspaces.forEach((entry, index) => {
    workspaceByKey.set(sidebarSessionKey(entry.serverId, entry.workspaceId), { entry, index });
  });
  const rows: Array<SidebarSessionRow & { workspaceIndex: number; createdAt: number }> = [];
  for (const host of input.hosts) {
    if (!host.agents) continue;
    for (const agent of host.agents.values()) {
      if (agent.archivedAt || !agent.workspaceId) continue;
      const parent = agent.parentAgentId ? host.agents.get(agent.parentAgentId) : undefined;
      if (!isWorkspaceRootAgent(agent, parent)) continue;
      if (sessionPinnedAt(agent) !== null) continue;
      const workspace = workspaceByKey.get(sidebarSessionKey(host.serverId, agent.workspaceId));
      if (!workspace) continue;
      if (input.query && !sessionTitleMatches(agent.title, input.query)) continue;
      const clocks = agentMessageTimestamps(agent);
      const sortAt = sessionSortClock(agent, clocks, input.sortMode);
      rows.push({
        key: sidebarSessionKey(host.serverId, agent.id),
        serverId: host.serverId,
        agentId: agent.id,
        workspaceId: agent.workspaceId,
        workspaceKey: workspace.entry.workspaceKey,
        provider: agent.provider,
        title: agent.title?.trim() || null,
        projectName: workspace.entry.projectName,
        workspaceName: workspace.entry.name,
        statusBucket: deriveSidebarStateBucket({
          status: workspaceAgentStatus(agent),
          pendingPermissionCount: agent.pendingPermissions.length,
          requiresAttention: agent.requiresAttention,
          labels: agent.labels,
          attentionReason: agent.attentionReason,
        }),
        sortAt,
        displayAt: input.sortMode === "started" ? agent.createdAt : clocks.conversation,
        workspaceIndex: workspace.index,
        createdAt: finiteTime(agent.createdAt),
      });
    }
  }
  rows.sort((left, right) => {
    switch (input.sortMode) {
      case "manual":
        return (
          left.workspaceIndex - right.workspaceIndex ||
          left.createdAt - right.createdAt ||
          left.key.localeCompare(right.key)
        );
      case "title":
        return (
          (left.title ?? "").localeCompare(right.title ?? "", undefined, {
            sensitivity: "base",
          }) || left.key.localeCompare(right.key)
        );
      default:
        return (
          finiteTime(right.sortAt) - finiteTime(left.sortAt) || left.key.localeCompare(right.key)
        );
    }
  });
  return rows.map(({ workspaceIndex: _index, createdAt: _createdAt, ...row }) => row);
}

function sessionTitleMatches(title: string | null, query: string): boolean {
  return Boolean(title?.normalize("NFKC").toLocaleLowerCase().includes(query));
}

function sessionSortClock(
  agent: Agent,
  clocks: { user: Date; assistant: Date; conversation: Date },
  mode: SidebarSortMode,
): Date {
  if (mode === "user") return clocks.user;
  if (mode === "assistant") return clocks.assistant;
  if (mode === "started") return agent.createdAt;
  return clocks.conversation;
}

function finiteTime(at: Date): number {
  const time = at.getTime();
  return Number.isFinite(time) ? time : 0;
}

/** The meta line under a session title: where it lives, and on which host when there are several. */
export function sidebarSessionMeta(
  row: Pick<SidebarSessionRow, "projectName" | "workspaceName">,
  hostLabel: string | null,
): string {
  const parts = [row.projectName];
  if (row.workspaceName && row.workspaceName !== row.projectName) parts.push(row.workspaceName);
  if (hostLabel) parts.push(hostLabel);
  return parts.join(" · ");
}
