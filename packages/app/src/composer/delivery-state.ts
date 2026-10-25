import type { PendingQueueEnqueue } from "@/stores/queue-outbox-store/model";
import { QUEUE_OUTBOX_MAX_ATTEMPTS } from "@/stores/queue-outbox-store/model";
import type { PendingDirectSend } from "@/stores/send-outbox-store/model";
import { SEND_OUTBOX_MAX_ATTEMPTS } from "@/stores/send-outbox-store/model";

/**
 * How far one of the user's own messages has travelled, in the spirit of a
 * messaging app's ticks. See docs/queue-mirroring.md, "Delivery marks".
 *
 * - `pending`: saved on this device; the host has not acknowledged it.
 * - `accepted`: the host has it (in its queue, or the send was accepted) but the
 *   agent has not echoed it back yet.
 * - `delivered`: the agent's timeline contains it.
 * - `attention`: the host refused it, or retries keep failing. Still saved.
 */
export type MessageDeliveryState = "pending" | "accepted" | "delivered" | "attention";

export interface ChatMessageDeliveryInput {
  /** The daemon assigned an id or cursor: the provider recorded the message. */
  isCanonical: boolean;
  /** A live submission record exists for this bubble. */
  submission?: { rpcSettled: boolean };
  /** The durable outbox still holds this message. */
  outboxEntry?: Pick<PendingDirectSend, "attempts" | "rejectedError">;
}

export function resolveChatMessageDeliveryState(
  input: ChatMessageDeliveryInput,
): MessageDeliveryState {
  if (input.isCanonical) return "delivered";
  if (input.outboxEntry && needsDirectSendAttention(input.outboxEntry)) return "attention";
  if (input.submission?.rpcSettled) return "accepted";
  return "pending";
}

export function needsDirectSendAttention(
  entry: Pick<PendingDirectSend, "attempts" | "rejectedError">,
): boolean {
  return entry.rejectedError !== undefined || entry.attempts >= SEND_OUTBOX_MAX_ATTEMPTS;
}

export interface QueuedMessageDeliveryInput {
  /** The local outbox entry, while the host has not acknowledged this item. */
  outboxEntry?: Pick<PendingQueueEnqueue, "attempts" | "removalRequested">;
  /** The latest authoritative host snapshot contains this item. */
  inHostQueue: boolean;
}

/**
 * Removal has its own labels; this maps only the forward path. A queued item is
 * never `delivered` here: once drained it leaves the queue and its delivered mark
 * appears on the chat bubble.
 */
export function resolveQueuedMessageDeliveryState(
  input: QueuedMessageDeliveryInput,
): MessageDeliveryState {
  if (input.inHostQueue) return "accepted";
  if (input.outboxEntry && input.outboxEntry.attempts >= QUEUE_OUTBOX_MAX_ATTEMPTS) {
    return "attention";
  }
  return "pending";
}
