import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import type { Agent } from "@/stores/session-store";
import { collectAllTabs, type WorkspaceLayout } from "@/stores/workspace-layout-actions";
import { isWorkspaceRootAgent } from "@/subagents/policies";
import { buildDeterministicWorkspaceTabId } from "@/workspace-tabs/identity";

/**
 * One row of Tabs grouping: an open tab, wherever it lives. The sidebar shows these instead of
 * workspaces below the pinned section (docs/sidebar-sorting.md#tabs-grouping).
 */
export interface SidebarTabRow {
  key: string;
  serverId: string;
  workspaceId: string;
  workspaceKey: string;
  tab: WorkspaceTabDescriptor;
  projectName: string;
  workspaceName: string;
  /**
   * `layout` when the tab comes from this device's layout for the workspace. `agents` when this
   * device has never laid the workspace out, so its top-level chats stand in for its tabs.
   */
  source: "layout" | "agents";
}

export interface SidebarTabHostAgents {
  serverId: string;
  agents: ReadonlyMap<string, Agent> | undefined;
}

export interface BuildSidebarTabRowsInput {
  hosts: readonly SidebarTabHostAgents[];
  /** The workspaces every sidebar filter leaves, in the order their tabs should appear. */
  workspaces: readonly SidebarWorkspaceEntry[];
  /** This device's layouts, keyed by `serverId:workspaceId` (the workspace entry's key). */
  layoutByWorkspace: Readonly<Record<string, WorkspaceLayout | undefined>>;
}

export function sidebarTabRowKey(workspaceKey: string, tabId: string): string {
  return JSON.stringify([workspaceKey, tabId]);
}

/**
 * Every open tab in the visible workspaces, workspace by workspace in the order given, each
 * workspace's tabs in pane order. Empty "new tab" placeholders are left out. A workspace this
 * device has no layout for lists its unarchived top-level chats, oldest first.
 */
export function buildSidebarTabRows(input: BuildSidebarTabRowsInput): SidebarTabRow[] {
  const agentsByServerId = new Map(input.hosts.map((host) => [host.serverId, host.agents]));
  const rows: SidebarTabRow[] = [];
  for (const workspace of input.workspaces) {
    const base = {
      serverId: workspace.serverId,
      workspaceId: workspace.workspaceId,
      workspaceKey: workspace.workspaceKey,
      projectName: workspace.projectName,
      workspaceName: workspace.name,
    };
    const layout = input.layoutByWorkspace[workspace.workspaceKey];
    if (layout) {
      const seen = new Set<string>();
      for (const tab of collectAllTabs(layout.root)) {
        if (tab.target.kind === "new_tab" || seen.has(tab.tabId)) continue;
        seen.add(tab.tabId);
        rows.push({
          ...base,
          key: sidebarTabRowKey(workspace.workspaceKey, tab.tabId),
          tab: {
            key: tab.tabId,
            tabId: tab.tabId,
            kind: tab.target.kind,
            target: tab.target,
            ...(tab.state !== undefined ? { state: tab.state } : {}),
          },
          source: "layout",
        });
      }
      continue;
    }
    const agents = agentsByServerId.get(workspace.serverId);
    if (!agents) continue;
    const chats = [...agents.values()].filter((agent) => {
      if (agent.archivedAt || agent.workspaceId !== workspace.workspaceId) return false;
      const parent = agent.parentAgentId ? agents.get(agent.parentAgentId) : undefined;
      return isWorkspaceRootAgent(agent, parent);
    });
    chats.sort(
      (left, right) =>
        finiteTime(left.createdAt) - finiteTime(right.createdAt) || left.id.localeCompare(right.id),
    );
    for (const agent of chats) {
      const target = { kind: "agent" as const, agentId: agent.id };
      const tabId = buildDeterministicWorkspaceTabId(target);
      rows.push({
        ...base,
        key: sidebarTabRowKey(workspace.workspaceKey, tabId),
        tab: { key: tabId, tabId, kind: "agent", target },
        source: "agents",
      });
    }
  }
  return rows;
}

function finiteTime(at: Date): number {
  const time = at.getTime();
  return Number.isFinite(time) ? time : 0;
}

/** The meta line under a tab title: where it lives, and on which host when there are several. */
export function sidebarTabMeta(
  row: Pick<SidebarTabRow, "projectName" | "workspaceName">,
  hostLabel: string | null,
): string {
  const parts = [row.projectName];
  if (row.workspaceName && row.workspaceName !== row.projectName) parts.push(row.workspaceName);
  if (hostLabel) parts.push(hostLabel);
  return parts.join(" · ");
}
