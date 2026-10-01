import { z } from "zod";
import {
  AgentAttachmentWireSchema,
  QueuedComposerAttachmentSchema,
  type AgentQueueSnapshot,
} from "@getpaseo/protocol/messages";

/**
 * A queue enqueue the daemon has not acknowledged yet. The entry is the durable
 * copy: it carries the full wire payload (image bytes included) so it can be
 * re-sent verbatim after a reconnect or a fresh app launch, even though the
 * optimistic composer row it mirrors lives only in memory.
 *
 * Re-sending is safe because the daemon treats an enqueue with a known item id —
 * queued or already drained — as a retry and does nothing.
 * See docs/queue-mirroring.md, "The un-acked window".
 */
export const PendingQueueEnqueueSchema = z.object({
  serverId: z.string(),
  agentId: z.string(),
  itemId: z.string(),
  text: z.string(),
  images: z.array(z.object({ data: z.string(), mimeType: z.string() })),
  attachments: z.array(AgentAttachmentWireSchema),
  composerAttachments: z.array(QueuedComposerAttachmentSchema),
  createdAt: z.number(),
  attempts: z.number().int().nonnegative(),
});

export type PendingQueueEnqueue = z.infer<typeof PendingQueueEnqueueSchema>;

/**
 * Alert threshold for a persistently failing enqueue. The payload remains in
 * the outbox and is retried on future reconnects until the daemon acknowledges
 * it; a retry limit must never discard a user's queued message.
 */
export const QUEUE_OUTBOX_MAX_ATTEMPTS = 8;

export interface QueueOutboxAccess {
  list: (serverId: string) => PendingQueueEnqueue[];
  remove: (itemId: string) => void;
  bumpAttempts: (itemId: string) => void;
}

export interface QueueOutboxFlushClient {
  enqueueAgentMessage: (input: {
    agentId: string;
    itemId: string;
    text: string;
    images?: Array<{ data: string; mimeType: string }>;
    attachments?: PendingQueueEnqueue["attachments"];
    composerAttachments?: PendingQueueEnqueue["composerAttachments"];
  }) => Promise<AgentQueueSnapshot>;
}

export interface FlushQueueOutboxInput {
  serverId: string;
  outbox: QueueOutboxAccess;
  client: QueueOutboxFlushClient;
  applySnapshot: (snapshot: AgentQueueSnapshot) => void;
  /** Called once when an entry first reaches the retry alert threshold. */
  onRetryLimit?: (entry: PendingQueueEnqueue) => void;
}

/**
 * Re-sends every un-acked enqueue for one server, oldest first so queue order
 * survives the retry. Only an acknowledgement removes the durable entry.
 */
export async function flushQueueOutbox(input: FlushQueueOutboxInput): Promise<void> {
  for (const entry of input.outbox.list(input.serverId)) {
    if (!input.outbox.list(input.serverId).some((pending) => pending.itemId === entry.itemId)) {
      continue;
    }
    try {
      const snapshot = await input.client.enqueueAgentMessage({
        agentId: entry.agentId,
        itemId: entry.itemId,
        text: entry.text,
        images: entry.images,
        attachments: entry.attachments,
        composerAttachments: entry.composerAttachments,
      });
      input.outbox.remove(entry.itemId);
      input.applySnapshot(snapshot);
    } catch {
      input.outbox.bumpAttempts(entry.itemId);
      if (entry.attempts + 1 === QUEUE_OUTBOX_MAX_ATTEMPTS) {
        input.onRetryLimit?.(entry);
      }
    }
  }
}
