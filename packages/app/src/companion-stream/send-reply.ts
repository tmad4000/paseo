import { buildReplyQuote } from "@/components/reply/composer-quote";
import { runOrderedAdmission } from "@/stores/delivery-outboxes";
import type { SendOutboxFlushClient } from "@/stores/send-outbox-store/model";
import type { QueueOutboxFlushClient } from "@/stores/queue-outbox-store/model";
import { generateMessageId } from "@/types/stream";

export async function sendStreamReply(input: {
  serverId: string;
  agentId: string;
  replyTo: string;
  text: string;
  client: SendOutboxFlushClient & Partial<QueueOutboxFlushClient>;
}): Promise<{ queued: boolean }> {
  const quoted = buildReplyQuote(input.replyTo);
  const text = quoted ? `${quoted}\n\n${input.text}` : input.text;
  const messageId = generateMessageId();
  return runOrderedAdmission({
    serverId: input.serverId,
    agentId: input.agentId,
    itemId: messageId,
    client: input.client,
    oneShot: { text, images: [], attachments: [] },
    run: (markDispatched) => {
      markDispatched();
      return input.client.sendAgentMessage(input.agentId, text, {
        messageId,
        images: [],
        attachments: [],
      });
    },
  });
}
