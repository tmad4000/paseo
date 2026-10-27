import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { i18n } from "@/i18n/i18next";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useAgentReadMarksStore } from "@/stores/agent-read-marks-store";
import { useSessionStore, type Agent } from "@/stores/session-store";

type SessionStoreSnapshot = ReturnType<typeof useSessionStore.getState>;

/** The same activity clock the tab strips reconcile against. */
export function readAgentActivityAt(
  state: SessionStoreSnapshot,
  serverId: string,
  agentId: string,
): number {
  const date =
    state.agentLastActivity.get(agentId) ??
    state.sessions[serverId]?.agents?.get(agentId)?.lastActivityAt;
  const timestamp = date?.getTime() ?? 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

/**
 * Attention that reading may clear. A pending permission is a question waiting for an answer,
 * so reading never resolves it; errors and finished turns are clearable.
 */
export function hasClearableAgentAttention(
  agent: Pick<Agent, "requiresAttention" | "attentionReason" | "pendingPermissions"> | undefined,
): boolean {
  return agent?.requiresAttention === true && !isAwaitingPermission(agent);
}

/** A chat waiting on a permission is answered, not read: no read control or read mark applies. */
export function isAwaitingPermission(
  agent: Pick<Agent, "requiresAttention" | "attentionReason" | "pendingPermissions"> | undefined,
): boolean {
  return (
    agent !== undefined &&
    ((agent.requiresAttention === true && agent.attentionReason === "permission") ||
      agent.pendingPermissions.length > 0)
  );
}

/**
 * The host-side half of a read: keep permission attention, and only clear attention raised at or
 * before what this device showed. See `clear_agent_attention.read`.
 */
export function agentReadClearOptions(agent: Pick<Agent, "attentionTimestamp"> | undefined): {
  read: { seenAttentionAt?: string };
} {
  const seen = agent?.attentionTimestamp;
  return { read: seen ? { seenAttentionAt: seen.toISOString() } : {} };
}

/** Mark this agent's tab dots read on this device, through the activity seen right now. */
export function markAgentReadLocally(input: { serverId: string; agentId: string }): void {
  const activityAt = readAgentActivityAt(useSessionStore.getState(), input.serverId, input.agentId);
  useAgentReadMarksStore.getState().markReadThrough({ ...input, activityAt });
}

/**
 * Explicit "Mark as read" for one agent, from its tab or switcher row: clears the host's
 * finished/error attention, then the tab's unread dot. When the host clear fails, nothing is
 * marked, so the tab and the sidebar keep agreeing that the chat is unread.
 */
export async function markAgentRead(input: {
  serverId: string;
  agentId: string;
  /** Defaults to the host's runtime client. */
  client?: Pick<DaemonClient, "clearAgentAttention"> | null;
}): Promise<void> {
  const { serverId, agentId } = input;
  const agent = useSessionStore.getState().sessions[serverId]?.agents?.get(agentId);
  if (isAwaitingPermission(agent)) {
    return;
  }
  if (hasClearableAgentAttention(agent)) {
    const client =
      input.client === undefined ? getHostRuntimeStore().getClient(serverId) : input.client;
    if (!client) {
      throw new Error(i18n.t("workspace.terminal.hostDisconnected"));
    }
    await client.clearAgentAttention(agentId, agentReadClearOptions(agent));
  }
  markAgentReadLocally({ serverId, agentId });
}
