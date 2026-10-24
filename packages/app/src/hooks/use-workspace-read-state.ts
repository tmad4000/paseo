import { useSessionStore } from "@/stores/session-store";
import { isWorkspaceRootAgent } from "@/subagents/policies";
import { useCallback, useMemo } from "react";
import { i18n } from "@/i18n/i18next";
import { useHostFeature } from "@/runtime/host-features";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import { markWorkspaceUnread } from "@/workspace/mark-unread";

export interface WorkspaceReadStateController {
  hasClearableAttention: boolean;
  canMarkUnread: boolean;
  clearAttention: () => Promise<void>;
  markUnread: () => Promise<void>;
}

export function useWorkspaceReadState({
  serverId,
  workspaceId,
}: {
  serverId: string;
  workspaceId: string;
}): WorkspaceReadStateController {
  const status = useWorkspaceFields(serverId, workspaceId, (workspace) => workspace.status);
  const supportsMarkUnread = useHostFeature(serverId, "workspaceMarkUnread");
  const hasEligibleReadAgent = useSessionStore((state) => {
    if (status === "done") return true;
    if (status !== "attention" && status !== "needs_input") return false;
    const agents = state.sessions[serverId]?.agents;
    if (!agents) return false;
    for (const agent of agents.values()) {
      if (agent.archivedAt || agent.workspaceId !== workspaceId) continue;
      const parent = agent.parentAgentId ? agents.get(agent.parentAgentId) : undefined;
      const finished = agent.status === "idle" || agent.status === "closed";
      if (
        isWorkspaceRootAgent(agent, parent) &&
        finished &&
        !agent.requiresAttention &&
        agent.pendingPermissions.length === 0
      )
        return true;
    }
    return false;
  });
  const hasClearableAttention = useSessionStore((state) => {
    if (status === "attention" || status === "failed") return true;
    if (status !== "needs_input") return false;
    const agents = state.sessions[serverId]?.agents;
    if (!agents) return false;
    for (const agent of agents.values()) {
      const ownedActiveAgent = !agent.archivedAt && agent.workspaceId === workspaceId;
      if (
        ownedActiveAgent &&
        agent.requiresAttention === true &&
        agent.attentionReason !== "permission"
      )
        return true;
    }
    return false;
  });
  const canMarkUnread = supportsMarkUnread && hasEligibleReadAgent;

  const clearAttention = useCallback(async () => {
    if (!hasClearableAttention) {
      return;
    }
    const client = getHostRuntimeStore().getClient(serverId);
    if (!client) {
      throw new Error(i18n.t("workspace.terminal.hostDisconnected"));
    }
    await client.clearWorkspaceAttention(workspaceId);
  }, [hasClearableAttention, serverId, workspaceId]);

  const markUnread = useCallback(async () => {
    if (!canMarkUnread) {
      return;
    }
    await markWorkspaceUnread(serverId, workspaceId);
  }, [canMarkUnread, serverId, workspaceId]);

  return useMemo(
    () => ({ hasClearableAttention, canMarkUnread, clearAttention, markUnread }),
    [canMarkUnread, clearAttention, hasClearableAttention, markUnread],
  );
}
