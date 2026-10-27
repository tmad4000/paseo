import { useCallback, useMemo } from "react";
import { useToast } from "@/contexts/toast-context";
import type { WorkspaceTabMenuEntry } from "@/screens/workspace/workspace-tab-menu";
import { useSessionStore } from "@/stores/session-store";
import { hasClearableAgentAttention, markAgentRead } from "@/workspace/mark-read";

export interface AgentReadAction {
  canMarkRead: boolean;
  markRead: () => void;
}

/**
 * "Mark as read" for one agent's tab. Offered while the tab shows an unread dot or the agent
 * holds clearable (finished/error) attention; never for a pending permission alone.
 */
export function useAgentReadAction(input: {
  serverId: string;
  agentId: string | null;
  unread: boolean;
}): AgentReadAction {
  const { serverId, agentId, unread } = input;
  const toast = useToast();
  const hasClearableAttention = useSessionStore((state) =>
    agentId ? hasClearableAgentAttention(state.sessions[serverId]?.agents?.get(agentId)) : false,
  );
  const canMarkRead = Boolean(agentId) && (unread || hasClearableAttention);
  const markRead = useCallback(() => {
    if (!agentId) return;
    void markAgentRead({ serverId, agentId }).catch((error) => {
      toast.error(error instanceof Error ? error.message : "Failed to mark tab as read");
    });
  }, [agentId, serverId, toast]);
  return useMemo(() => ({ canMarkRead, markRead }), [canMarkRead, markRead]);
}

/** The tab menu's "Mark as read" item, placed beside "Mark as unread". */
export function buildMarkReadMenuEntries(input: {
  action: AgentReadAction;
  label: string;
  menuTestIDBase: string;
}): WorkspaceTabMenuEntry[] {
  if (!input.action.canMarkRead) return [];
  return [
    {
      kind: "item",
      key: "mark-as-read",
      label: input.label,
      icon: "circle-check",
      testID: `${input.menuTestIDBase}-mark-as-read`,
      onSelect: input.action.markRead,
    },
    { kind: "separator", key: "mark-as-read-separator" },
  ];
}
