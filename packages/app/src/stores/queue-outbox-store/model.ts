import { AgentQueueDestinationChangedError } from "@getpaseo/client/internal/daemon-client";
import { z } from "zod";
import {
  AgentAttachmentWireSchema,
  QueuedComposerAttachmentSchema,
  type AgentQueueSnapshot,
  type ServerInfoStatusPayload,
} from "@getpaseo/protocol/messages";

/**
 * Durable enqueue payload or removal intent. A cancellation must survive host
 * acceptance so a lost enqueue response cannot cause the canceled item to be resent.
 * See docs/queue-mirroring.md, "The un-acked window".
 */
export const PendingQueueEnqueueSchema = z.object({
  serverId: z.string(),
  agentId: z.string(),
  expectedWorkspaceId: z.string().optional(),
  expectedProjectId: z.string().optional(),
  routingOrigin: z.boolean().optional(),
  routingDispatchHeld: z.boolean().optional(),
  routingDraftUpdatedAt: z.number().nonnegative().optional(),
  routingDraftVersion: z.number().int().nonnegative().optional(),
  itemId: z.string(),
  text: z.string(),
  images: z.array(z.object({ data: z.string(), mimeType: z.string() })),
  attachments: z.array(AgentAttachmentWireSchema),
  composerAttachments: z.array(QueuedComposerAttachmentSchema),
  createdAt: z.number(),
  attempts: z.number().int().nonnegative(),
  removalRequested: z.boolean().optional(),
});

export type PendingQueueEnqueue = z.infer<typeof PendingQueueEnqueueSchema>;

/**
 * A retry alert must never discard a user's queued payload or cancellation intent.
 * See docs/queue-mirroring.md, "The un-acked window", for retry behavior.
 */
export const QUEUE_OUTBOX_MAX_ATTEMPTS = 8;

export interface QueueOutboxAccess {
  list: (serverId: string) => PendingQueueEnqueue[];
  remove: (itemId: string, preserveRemovalIntent?: boolean) => void | Promise<void>;
  get?: (itemId: string) => PendingQueueEnqueue | undefined;
  bumpAttempts: (itemId: string) => void | Promise<void>;
}

export interface QueueOutboxFlushClient {
  getLastServerInfoMessage?: () => Pick<ServerInfoStatusPayload, "features"> | null;
  removeQueuedAgentMessage?: (agentId: string, itemId: string) => Promise<AgentQueueSnapshot>;
  enqueueAgentMessage: (input: {
    agentId: string;
    expectedWorkspaceId?: string;
    expectedProjectId?: string;
    itemId: string;
    text: string;
    images?: Array<{ data: string; mimeType: string }>;
    attachments?: PendingQueueEnqueue["attachments"];
    composerAttachments?: PendingQueueEnqueue["composerAttachments"];
  }) => Promise<AgentQueueSnapshot>;
}

export interface FlushQueueOutboxInput {
  serverId: string;
  itemId?: string;
  outbox: QueueOutboxAccess;
  client: QueueOutboxFlushClient;
  applySnapshot: (snapshot: AgentQueueSnapshot) => void;
  /** Called once when an entry first reaches the retry alert threshold. */
  onRetryLimit?: (entry: PendingQueueEnqueue) => void;
  onRejected?: (entry: PendingQueueEnqueue, message: string) => void;
  onAcknowledged?: (
    entry: PendingQueueEnqueue,
    snapshot: AgentQueueSnapshot,
  ) => boolean | void | Promise<boolean | void>;
}

const queueOperations = new Map<string, Promise<unknown>>();

export async function serializeQueueOperation<T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = queueOperations.get(key) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  queueOperations.set(key, current);
  try {
    return await current;
  } finally {
    if (queueOperations.get(key) === current) queueOperations.delete(key);
  }
}

function canRetryEnqueue(entry: PendingQueueEnqueue, client: QueueOutboxFlushClient): boolean {
  if (!entry.routingOrigin || entry.removalRequested) return true;
  // COMPAT(sessionSearch): added in v0.10.0, remove gate after 2027-04-04.
  // Older queue handlers discard expected destination IDs. Retain ownership
  // until this connection can validate them, including after a rollback.
  const features = client.getLastServerInfoMessage?.()?.features;
  return features?.sessionSearch === true && features.agentMessageQueue === true;
}

function getOutboxEntry(
  input: FlushQueueOutboxInput,
  itemId: string,
): PendingQueueEnqueue | undefined {
  return input.outbox.get
    ? input.outbox.get(itemId)
    : input.outbox.list(input.serverId).find((entry) => entry.itemId === itemId);
}

export async function flushQueueOutbox(input: FlushQueueOutboxInput): Promise<void> {
  const agents = new Set(
    input.outbox
      .list(input.serverId)
      .filter((entry) => input.itemId === undefined || entry.itemId === input.itemId)
      .map((entry) => entry.agentId),
  );
  await Promise.all(
    [...agents].map((agentId) =>
      serializeQueueOperation(JSON.stringify(["dispatch", input.serverId, agentId]), async () => {
        for (const candidate of input.outbox
          .list(input.serverId)
          .filter(
            (item) =>
              item.agentId === agentId &&
              (input.itemId === undefined || item.itemId === input.itemId),
          )) {
          const entry = getOutboxEntry(input, candidate.itemId);
          if (!entry) continue;
          if (entry.routingDispatchHeld && !entry.removalRequested) break;
          if (!canRetryEnqueue(entry, input.client)) continue;
          try {
            const removeFromHost = async () => {
              if (!input.client.removeQueuedAgentMessage)
                throw new Error("Queue removal unavailable");
              return input.client.removeQueuedAgentMessage(entry.agentId, entry.itemId);
            };
            let snapshot = entry.removalRequested
              ? await removeFromHost()
              : await input.client.enqueueAgentMessage({
                  agentId: entry.agentId,
                  expectedWorkspaceId: entry.expectedWorkspaceId,
                  expectedProjectId: entry.expectedProjectId,
                  itemId: entry.itemId,
                  text: entry.text,
                  images: entry.images,
                  attachments: entry.attachments,
                  composerAttachments: entry.composerAttachments,
                });
            if (!entry.removalRequested) {
              const acknowledged = await input.onAcknowledged?.(entry, snapshot);
              if (acknowledged === false) break;
              // A cancellation that raced acknowledgement must survive until the host confirms removal.
              await input.outbox.remove(entry.itemId, true);
              const latest = getOutboxEntry(input, entry.itemId);
              if (latest?.removalRequested) {
                snapshot = await removeFromHost();
                await input.outbox.remove(entry.itemId);
              }
            } else {
              await input.outbox.remove(entry.itemId);
            }
            input.applySnapshot(snapshot);
          } catch (error) {
            if (!entry.removalRequested && error instanceof AgentQueueDestinationChangedError) {
              await input.outbox.remove(entry.itemId);
              input.onRejected?.(entry, error.message);
              continue;
            }
            await input.outbox.bumpAttempts(entry.itemId);
            if (entry.attempts + 1 === QUEUE_OUTBOX_MAX_ATTEMPTS) input.onRetryLimit?.(entry);
            break;
          }
        }
      }),
    ),
  );
}
