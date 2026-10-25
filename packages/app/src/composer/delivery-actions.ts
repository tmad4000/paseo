import { createDirectSendAcceptanceHandler } from "@/composer/submission/direct-send-outbox";
import { createMessageSubmissionWriter } from "@/composer/submission/writer";
import { i18n } from "@/i18n/i18next";
import { useSessionStore } from "@/stores/session-store";
import {
  flushSendOutboxForServer,
  isUncertainSendOutcome,
  SEND_OUTBOX_MAX_ATTEMPTS,
  supportsDurableDirectSend,
  useSendOutboxStore,
  type PendingDirectSend,
} from "@/stores/send-outbox-store";
import type { SendOutboxFlushClient } from "@/stores/send-outbox-store/model";
import { confirmDialog } from "@/utils/confirm-dialog";

/** Sends one saved message again now, with the same id so the host can dedupe it. */
export async function retryDirectSend(input: {
  entry: PendingDirectSend;
  client: SendOutboxFlushClient;
}): Promise<void> {
  const { entry, client } = input;
  // Same guard as the reconnect flush: never resend to a host that cannot dedupe.
  const serverInfo = useSessionStore.getState().sessions[entry.serverId]?.serverInfo;
  if (serverInfo && !supportsDurableDirectSend(serverInfo.features)) {
    throw new Error(i18n.t("composer.delivery.retryUnsupported"));
  }
  await useSendOutboxStore.getState().clearRejectionDurably(entry.clientMessageId);
  await flushSendOutboxForServer({
    serverId: entry.serverId,
    agentId: entry.agentId,
    client,
    onAccepted: createDirectSendAcceptanceHandler(entry.serverId),
  });
}

/** Drops a saved message the user no longer wants delivered. */
export async function discardDirectSend(entry: PendingDirectSend): Promise<void> {
  await useSendOutboxStore.getState().removeDurably(entry.clientMessageId);
  createMessageSubmissionWriter(entry.serverId).reject(entry.agentId, entry.clientMessageId);
}

/**
 * Moves a refused message back into its chat's composer for editing. Only a
 * refused message may move: one still retrying could be in the host already.
 * `restoreText` receives the composer's current text plus the message.
 */
export async function editDirectSend(input: {
  entry: PendingDirectSend;
  currentText: string;
  restoreText: (text: string) => void;
}): Promise<void> {
  const current = input.currentText.trim();
  input.restoreText(current ? `${current}\n\n${input.entry.text}` : input.entry.text);
  await discardDirectSend(input.entry);
}

export function describeDirectSendAttention(entry: PendingDirectSend): string {
  if (isUncertainSendOutcome(entry.rejectedError)) {
    return i18n.t("composer.delivery.uncertainDetail");
  }
  if (entry.rejectedError !== undefined) {
    return i18n.t("composer.delivery.rejectedDetail", { error: entry.rejectedError });
  }
  return i18n.t("composer.delivery.retryingDetail", {
    count: Math.max(entry.attempts, SEND_OUTBOX_MAX_ATTEMPTS),
  });
}

/** Explains why a message is not delivered and offers to send it again now. */
export async function promptDirectSendAttention(input: {
  entry: PendingDirectSend;
  client: SendOutboxFlushClient | null;
}): Promise<void> {
  const confirmed = await confirmDialog({
    title: i18n.t("composer.delivery.attentionTitle"),
    message: describeDirectSendAttention(input.entry),
    confirmLabel: i18n.t("composer.delivery.retryNow"),
    cancelLabel: i18n.t("composer.delivery.keepWaiting"),
  });
  if (!confirmed || !input.client) return;
  await retryDirectSend({ entry: input.entry, client: input.client });
}
