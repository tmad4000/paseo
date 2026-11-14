import type { DirectSendOutbox } from "@/composer/actions";
import { createMessageSubmissionWriter } from "@/composer/submission/writer";
import { useSessionStore } from "@/stores/session-store";
import {
  flushSendOutboxForServer,
  supportsDurableDirectSend,
  useSendOutboxStore,
  type PendingDirectSend,
} from "@/stores/send-outbox-store";
import type { SendOutboxFlushClient } from "@/stores/send-outbox-store/model";

/**
 * Reports a host acceptance to the chat's optimistic bubble, if this session
 * still has one. A queued answer retires the bubble because the daemon queue
 * now shows the message; a provider echo that raced it is preserved.
 */
export function createDirectSendAcceptanceHandler(serverId: string) {
  return (entry: PendingDirectSend, result: { queued: boolean }) => {
    const writer = createMessageSubmissionWriter(serverId);
    if (result.queued) writer.reject(entry.agentId, entry.clientMessageId);
    else writer.accept(entry.agentId, entry.clientMessageId);
  };
}

/** Returns the durable outbox for hosts that dedupe retried sends, otherwise undefined. */
export function createDirectSendOutbox(
  serverId: string,
  client: SendOutboxFlushClient,
): DirectSendOutbox | undefined {
  const serverInfo = useSessionStore.getState().sessions[serverId]?.serverInfo;
  // Before this connection reports features, trust what the host last reported.
  const supported = serverInfo
    ? supportsDurableDirectSend(serverInfo.features)
    : useSendOutboxStore.getState().durableHosts?.[serverId] === true;
  if (!supported) return undefined;
  return {
    serverId,
    add: (entry) => useSendOutboxStore.getState().add(entry),
    flush: (agentId) =>
      flushSendOutboxForServer({
        serverId,
        agentId,
        client,
        onAccepted: createDirectSendAcceptanceHandler(serverId),
      }),
    get: (clientMessageId) => useSendOutboxStore.getState().entries[clientMessageId],
    remove: (clientMessageId) => useSendOutboxStore.getState().removeDurably(clientMessageId),
  };
}
