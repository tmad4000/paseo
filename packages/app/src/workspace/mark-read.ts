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
  return (
    agent?.requiresAttention === true &&
    agent.attentionReason !== "permission" &&
    agent.pendingPermissions.length === 0
  );
}

/** Mark this agent's tab dots read on this device, through the activity seen right now. */
export function markAgentReadLocally(input: { serverId: string; agentId: string }): void {
  const activityAt = readAgentActivityAt(useSessionStore.getState(), input.serverId, input.agentId);
  useAgentReadMarksStore.getState().markReadThrough({ ...input, activityAt });
}

/**
 * Explicit "Mark as read" for one agent, from its tab or switcher row: clears the tab's unread
 * dot and the host's finished/error attention. Permission attention is left alone.
 */
export async function markAgentRead(input: {
  serverId: string;
  agentId: string;
  /** Defaults to the host's runtime client. */
  client?: Pick<DaemonClient, "clearAgentAttention"> | null;
}): Promise<void> {
  const { serverId, agentId } = input;
  markAgentReadLocally({ serverId, agentId });
  const agent = useSessionStore.getState().sessions[serverId]?.agents?.get(agentId);
  if (!hasClearableAgentAttention(agent)) {
    return;
  }
  const client =
    input.client === undefined ? getHostRuntimeStore().getClient(serverId) : input.client;
  if (!client) {
    throw new Error(i18n.t("workspace.terminal.hostDisconnected"));
  }
  await client.clearAgentAttention(agentId);
}
