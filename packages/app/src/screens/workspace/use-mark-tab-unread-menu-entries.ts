import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/contexts/toast-context";
import { useHostFeature } from "@/runtime/host-features";
import type { WorkspaceTabMenuEntry } from "@/screens/workspace/workspace-tab-menu";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { useSessionStore } from "@/stores/session-store";
import { markAgentTabUnread } from "@/workspace/mark-unread";

/**
 * "Mark as unread" for an agent tab: restores the finished-agent attention the user already read,
 * like the sidebar's workspace action but for exactly this tab's agent.
 */
export function useMarkTabUnreadMenuEntries(input: {
  tab: WorkspaceTabDescriptor;
  serverId: string;
  workspaceId: string;
  menuTestIDBase: string;
}): WorkspaceTabMenuEntry[] {
  const { t } = useTranslation();
  const toast = useToast();
  const { tab, serverId, workspaceId, menuTestIDBase } = input;
  const agentId = tab.target.kind === "agent" ? tab.target.agentId : null;
  const supported = useHostFeature(serverId, "agentMarkUnread");
  const canMarkUnread = useSessionStore((state) => {
    if (!agentId) return false;
    const agent = state.sessions[serverId]?.agents?.get(agentId);
    if (!agent) return false;
    const isFinished = agent.status === "idle" || agent.status === "closed";
    return isFinished && agent.requiresAttention !== true && agent.pendingPermissions.length === 0;
  });

  return useMemo(() => {
    if (!agentId || !supported || !canMarkUnread || tab.scope || !workspaceId) return [];
    return [
      {
        kind: "item",
        key: "mark-as-unread",
        label: t("workspace.tabs.menu.markAsUnread", { defaultValue: "Mark as unread" }),
        icon: "circle",
        testID: `${menuTestIDBase}-mark-as-unread`,
        onSelect: () => {
          void markAgentTabUnread({ serverId, workspaceId, agentId, tabId: tab.tabId }).catch(
            (error) => {
              toast.error(error instanceof Error ? error.message : "Failed to mark tab as unread");
            },
          );
        },
      },
      { kind: "separator", key: "mark-as-unread-separator" },
    ];
  }, [
    agentId,
    canMarkUnread,
    menuTestIDBase,
    serverId,
    supported,
    t,
    tab.scope,
    tab.tabId,
    toast,
    workspaceId,
  ]);
}
