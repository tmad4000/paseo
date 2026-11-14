import {
  awaitSendOutboxHydration,
  flushSendOutboxEntriesForServer,
  isUncertainSendOutcome,
  useSendOutboxStore,
  type SendOutboxServerInput,
} from "@/stores/send-outbox-store";
import {
  awaitOutboxHydration,
  flushQueueOutboxEntriesForServer,
  useQueueOutboxStore,
  type QueueOutboxServerInput,
} from "@/stores/queue-outbox-store";
import { serializeQueueOperation, type QueueOutboxFlushClient } from "@/stores/queue-outbox-store/model";
import { supportsDurableDirectSend, type SendOutboxFlushClient } from "@/stores/send-outbox-store/model";
import { createDirectSendAcceptanceHandler } from "@/composer/submission/direct-send-outbox";
import { useSessionStore } from "@/stores/session-store";

export async function flushDeliveryOutboxes(input: {
  serverId: string;
  agentId?: string;
  client: Partial<SendOutboxFlushClient & QueueOutboxFlushClient>;
  direct?: SendOutboxServerInput;
  queue?: QueueOutboxServerInput;
}): Promise<void> {
  await Promise.all([awaitSendOutboxHydration(), awaitOutboxHydration()]);
  const { serverId, client } = input;
  const directEntries = () => Object.values(useSendOutboxStore.getState().entries).filter(
    (entry) => entry.serverId === serverId &&
      (entry.rejectedError === undefined || isUncertainSendOutcome(entry.rejectedError)),
  );
  const queueEntries = () => Object.values(useQueueOutboxStore.getState().entries).filter(
    (entry) => entry.serverId === serverId,
  );
  const features = client.getLastServerInfoMessage?.()?.features ??
    useSessionStore.getState().sessions[serverId]?.serverInfo?.features;
  const direct = input.direct ?? (client.sendAgentMessage && (!features || supportsDurableDirectSend(features)) ? {
    serverId,
    client: { sendAgentMessage: client.sendAgentMessage.bind(client) },
    onAccepted: createDirectSendAcceptanceHandler(serverId),
  } : undefined);
  const queue = input.queue ?? (client.enqueueAgentMessage && (!features || features.agentMessageQueue === true) ? {
    serverId,
    client: {
      enqueueAgentMessage: client.enqueueAgentMessage.bind(client),
      removeQueuedAgentMessage: client.removeQueuedAgentMessage?.bind(client),
      getLastServerInfoMessage: client.getLastServerInfoMessage?.bind(client),
    },
    applySnapshot: (snapshot) => useSessionStore.getState().applyAgentQueueSnapshot(serverId, snapshot),
  } satisfies QueueOutboxServerInput : undefined);
  const agents = new Set([...directEntries(), ...queueEntries()].map((entry) => entry.agentId));
  await Promise.all([...agents].filter((agentId) => input.agentId === undefined || input.agentId === agentId).map(async (agentId) => {
      if (queue) {
        for (const entry of queueEntries().filter((entry) => entry.agentId === agentId && entry.removalRequested)) {
          await flushQueueOutboxEntriesForServer({ ...queue, itemId: entry.itemId });
        }
      }
      await serializeQueueOperation(JSON.stringify(["delivery", serverId, agentId]), async () => {
      while (true) {
        const pending = [
          ...directEntries().filter((entry) => entry.agentId === agentId).map((entry) => ({ kind: "direct" as const, entry })),
          ...queueEntries().filter((entry) => entry.agentId === agentId && !entry.removalRequested).map((entry) => ({ kind: "queue" as const, entry })),
        ].sort((a, b) => a.entry.createdAt - b.entry.createdAt);
        const next = pending[0];
        if (!next) break;
        if (next.kind === "direct") {
          if (!direct || isUncertainSendOutcome(next.entry.rejectedError)) break;
          const id = next.entry.clientMessageId;
          if (!useSendOutboxStore.getState().entriesForServer(serverId).some((entry) => entry.clientMessageId === id)) break;
          await flushSendOutboxEntriesForServer({ ...direct, agentId, clientMessageId: id });
          if (directEntries().some((entry) => entry.clientMessageId === id)) break;
        } else {
          if (!queue) break;
          const id = next.entry.itemId;
          if (!useQueueOutboxStore.getState().entriesForServer(serverId).some((entry) => entry.itemId === id)) break;
          await flushQueueOutboxEntriesForServer({ ...queue, itemId: id });
          if (queueEntries().some((entry) => entry.itemId === id)) break;
        }
      }
      });
    }),
  );
}
