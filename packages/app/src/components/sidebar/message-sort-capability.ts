import type { HostFeatureSessionState } from "@/runtime/host-features";
import type { DaemonServerInfo } from "@/stores/session-store";

/**
 * The saved sort always applies. A host without conversationMessageActivity sends no
 * `messageActivity`, so its chats sort by the legacy last-user-message clock (falling back to
 * creation time). Hosts whose server info has not arrived yet get no label.
 *
 * Returns the distinct labels ("SDMM770 (0.10.0-beta.11)") the sort notice names: hosts that
 * reported server info without message activity, including ones that have since disconnected,
 * since their cached chats still sort by legacy clocks.
 */
// COMPAT(conversationMessageActivity): added in fork v0.10.0-beta.13; remove after 2027-04-06.
export function olderMessageSortHosts(
  state: HostFeatureSessionState,
  serverIds: readonly string[],
): string[] {
  const labels = serverIds.flatMap((serverId) => {
    const label = olderHostLabel(serverId, state.sessions[serverId]?.serverInfo);
    return label ? [label] : [];
  });
  return [...new Set(labels)];
}

function olderHostLabel(
  serverId: string,
  serverInfo: DaemonServerInfo | null | undefined,
): string | null {
  if (!serverInfo || serverInfo.features?.conversationMessageActivity === true) return null;
  const name = serverInfo.hostname ?? serverId;
  return serverInfo.version ? `${name} (${serverInfo.version})` : name;
}
