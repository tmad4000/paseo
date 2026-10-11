import type { DaemonServerInfo } from "@/stores/session-store";

/**
 * The saved sort always applies. A host without conversationMessageActivity sends no
 * `messageActivity`, so its chats sort by the legacy last-user-message clock (falling back to
 * creation time). Hosts whose server info has not arrived are unknown, not older, and get no label.
 *
 * Returns the label the sort notice names for a connected older host, or null.
 */
// COMPAT(conversationMessageActivity): added in fork v0.10.0-beta.13; remove after 2027-04-06.
export function olderMessageSortHostLabel(
  serverId: string,
  serverInfo: DaemonServerInfo | null | undefined,
): string | null {
  if (!serverInfo || serverInfo.features?.conversationMessageActivity === true) return null;
  const name = serverInfo.hostname ?? serverId;
  return serverInfo.version ? `${name} (${serverInfo.version})` : name;
}
