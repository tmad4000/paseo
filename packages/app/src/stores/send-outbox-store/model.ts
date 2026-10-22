import { DaemonConnectionError } from "@getpaseo/client/internal/daemon-client";
import { z } from "zod";
import {
  ActiveTurnBehaviorSchema,
  AgentAttachmentWireSchema,
  type ServerInfoStatusPayload,
} from "@getpaseo/protocol/messages";

import { serializeQueueOperation } from "@/stores/queue-outbox-store/model";

/**
 * A direct send the host has not acknowledged. It is written before the request
 * goes out and retried with the identical request on every reconnect, so the
 * daemon's per-message receipts (or queue item ids) dedupe a retry of a request
 * that did arrive. See docs/queue-mirroring.md, "Direct sends".
 */
export const PendingDirectSendSchema = z.object({
  serverId: z.string(),
  agentId: z.string(),
  clientMessageId: z.string(),
  text: z.string(),
  images: z.array(z.object({ data: z.string(), mimeType: z.string() })),
  attachments: z.array(AgentAttachmentWireSchema),
  activeTurnBehavior: ActiveTurnBehaviorSchema.optional(),
  interrupt: z.boolean().optional(),
  createdAt: z.number(),
  attempts: z.number().int().nonnegative(),
  /** Set when the host answered with a refusal; such entries wait for the user. */
  rejectedError: z.string().optional(),
});

export type PendingDirectSend = z.infer<typeof PendingDirectSendSchema>;

/** Same threshold as the queue outbox: past it, the row asks for attention but keeps retrying. */
export const SEND_OUTBOX_MAX_ATTEMPTS = 8;

/**
 * A transport failure says nothing about whether the host received the request,
 * so the entry stays and is retried with the same id. Anything else is the
 * host's answer and must not be retried blindly.
 */
export function isTransportFailure(error: unknown): boolean {
  return error instanceof DaemonConnectionError;
}

/**
 * Retrying is only safe when the host dedupes by message id on every send path:
 * receipts for steer/interrupt and queue item ids for ordinary input.
 */
export function supportsDurableDirectSend(
  features: ServerInfoStatusPayload["features"] | null | undefined,
): boolean {
  return features?.agentRequestReceipts === true && features?.agentMessageQueue === true;
}

export interface SendOutboxAccess {
  list: (serverId: string) => PendingDirectSend[];
  get: (clientMessageId: string) => PendingDirectSend | undefined;
  remove: (clientMessageId: string) => void | Promise<void>;
  bumpAttempts: (clientMessageId: string) => void | Promise<void>;
  markRejected: (clientMessageId: string, error: string) => void | Promise<void>;
}

export interface SendOutboxFlushClient {
  sendAgentMessage: (
    agentId: string,
    text: string,
    options: {
      messageId: string;
      activeTurnBehavior?: PendingDirectSend["activeTurnBehavior"];
      images: PendingDirectSend["images"];
      attachments: PendingDirectSend["attachments"];
      interrupt?: boolean;
    },
  ) => Promise<{ queued: boolean }>;
}

export interface FlushSendOutboxInput {
  serverId: string;
  /** Limits the flush to one agent, e.g. right after the composer adds a message. */
  agentId?: string;
  outbox: SendOutboxAccess;
  client: SendOutboxFlushClient;
  onAccepted?: (entry: PendingDirectSend, result: { queued: boolean }) => void;
  onRejected?: (entry: PendingDirectSend, message: string) => void;
  /** Called once when an entry first reaches the retry alert threshold. */
  onRetryLimit?: (entry: PendingDirectSend) => void;
}

export function sendOutboxOperationKey(serverId: string, agentId: string): string {
  return JSON.stringify(["direct-send", serverId, agentId]);
}

export function buildDirectSendOptions(entry: PendingDirectSend) {
  return {
    messageId: entry.clientMessageId,
    ...(entry.activeTurnBehavior ? { activeTurnBehavior: entry.activeTurnBehavior } : {}),
    images: entry.images,
    attachments: entry.attachments,
    ...(entry.interrupt ? { interrupt: true } : {}),
  };
}

/**
 * Resends every un-acknowledged direct send for one host, oldest first within
 * each agent. A transport failure stops that agent's retries so later messages
 * cannot overtake an earlier one; a refusal parks the entry for the user and
 * lets the agent's later messages proceed.
 */
export async function flushSendOutbox(input: FlushSendOutboxInput): Promise<void> {
  const agents = new Set(
    input.outbox
      .list(input.serverId)
      .map((entry) => entry.agentId)
      .filter((agentId) => input.agentId === undefined || agentId === input.agentId),
  );
  await Promise.all(
    [...agents].map((agentId) =>
      serializeQueueOperation(sendOutboxOperationKey(input.serverId, agentId), async () => {
        for (const candidate of input.outbox
          .list(input.serverId)
          .filter((item) => item.agentId === agentId)) {
          const entry = input.outbox.get(candidate.clientMessageId);
          if (!entry || entry.rejectedError !== undefined) continue;
          try {
            const result = await input.client.sendAgentMessage(
              entry.agentId,
              entry.text,
              buildDirectSendOptions(entry),
            );
            await input.outbox.remove(entry.clientMessageId);
            input.onAccepted?.(entry, result);
          } catch (error) {
            if (!isTransportFailure(error)) {
              const message = error instanceof Error ? error.message : String(error);
              await input.outbox.markRejected(entry.clientMessageId, message);
              input.onRejected?.(entry, message);
              continue;
            }
            await input.outbox.bumpAttempts(entry.clientMessageId);
            if (entry.attempts + 1 === SEND_OUTBOX_MAX_ATTEMPTS) input.onRetryLimit?.(entry);
            break;
          }
        }
      }),
    ),
  );
}
