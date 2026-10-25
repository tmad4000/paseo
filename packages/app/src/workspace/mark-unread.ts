import { i18n } from "@/i18n/i18next";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { findPaneById } from "@/stores/workspace-layout-actions";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";

export async function markWorkspaceUnread(serverId: string, workspaceId: string): Promise<void> {
  const client = getHostRuntimeStore().getClient(serverId);
  if (!client) {
    throw new Error(i18n.t("workspace.terminal.hostDisconnected"));
  }

  const workspaceKey = `${serverId}:${workspaceId}`;
  const layout = useWorkspaceLayoutStore.getState();
  // End viewing before restoring attention. The next pane focus reads it normally;
  // leaving the workspace must not consume the mark the user just made.
  const focusToken = layout.layoutByWorkspace[workspaceKey]?.focusedPaneId
    ? layout.unfocusPane(workspaceKey)
    : null;
  try {
    await client.markWorkspaceUnread(workspaceId);
  } catch (error) {
    if (focusToken) {
      layout.restorePaneFocus(workspaceKey, focusToken);
    }
    throw error;
  }
}

/**
 * Mark one agent unread, e.g. from its tab's context menu. Only when that agent's tab is the one
 * being viewed do we end viewing first, so the mark is not consumed on the spot; marking a
 * background tab leaves focus alone.
 */
export async function markAgentTabUnread(input: {
  serverId: string;
  workspaceId: string;
  agentId: string;
  tabId: string;
}): Promise<void> {
  const { serverId, workspaceId, agentId, tabId } = input;
  const client = getHostRuntimeStore().getClient(serverId);
  if (!client) {
    throw new Error(i18n.t("workspace.terminal.hostDisconnected"));
  }

  const workspaceKey = `${serverId}:${workspaceId}`;
  const layoutStore = useWorkspaceLayoutStore.getState();
  const layout = layoutStore.layoutByWorkspace[workspaceKey];
  const focusedPane = layout ? findPaneById(layout.root, layout.focusedPaneId) : null;
  const focusToken =
    focusedPane?.focusedTabId === tabId ? layoutStore.unfocusPane(workspaceKey) : null;
  try {
    await client.markAgentUnread(workspaceId, agentId);
  } catch (error) {
    if (focusToken) {
      layoutStore.restorePaneFocus(workspaceKey, focusToken);
    }
    throw error;
  }
}
