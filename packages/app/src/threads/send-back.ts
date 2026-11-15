import { generateMessageId } from "@/types/stream";
import { flushQueueOutboxForServer, useQueueOutboxStore } from "@/stores/queue-outbox-store";
import type { QueueOutboxFlushClient } from "@/stores/queue-outbox-store/model";
import type { SendOutboxFlushClient } from "@/stores/send-outbox-store/model";
import { useSessionStore } from "@/stores/session-store";
import { buildSendBackText } from "./model";

export async function queueThreadAnswer(input: {
  serverId: string;
  parentAgentId: string;
  threadAgentId: string;
  threadTitle: string;
  reply: string;
  client: QueueOutboxFlushClient & Partial<SendOutboxFlushClient>;
}): Promise<string> {
  const itemId = generateMessageId();
  await useQueueOutboxStore.getState().add({
    serverId: input.serverId,
    agentId: input.parentAgentId,
    itemId,
    text: buildSendBackText(input),
    images: [],
    attachments: [],
    composerAttachments: [],
  });
  void flushQueueOutboxForServer({
    serverId: input.serverId,
    client: input.client,
    applySnapshot: (snapshot) =>
      useSessionStore.getState().applyAgentQueueSnapshot(input.serverId, snapshot),
  }).catch(() => {});
  return itemId;
}
