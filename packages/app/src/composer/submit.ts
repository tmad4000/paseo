import type {
  PreparationRecovery,
  PreparedDraftHold,
} from "@/composer/submission/preparation-recovery";
import { i18n } from "@/i18n/i18next";

export type AgentInputSubmitResult = "noop" | "queued" | "submitted" | "failed";

export interface AgentInputSubmitActionInput<TAttachment> {
  message: string;
  attachments: TAttachment[];
  hasExternalContent?: boolean;
  allowEmptySubmit?: boolean;
  submitBehavior?: "clear" | "preserve-and-lock";
  forceSend?: boolean;
  isAgentRunning: boolean;
  canSubmit: boolean;
  queueMessage: (input: { message: string; attachments: TAttachment[] }) => void | Promise<void>;
  submitMessage: (input: { message: string; attachments: TAttachment[] }) => Promise<void>;
  getDraftRevision: () => unknown;
  recovery: PreparationRecovery<TAttachment>;
  clearDraft: (lifecycle: "sent" | "abandoned") => void;
  setUserInput: (text: string) => void;
  setAttachments: (attachments: TAttachment[]) => void;
  setSendError: (message: string | null) => void;
  setIsProcessing: (isProcessing: boolean) => void;
  onSubmitError?: (error: unknown) => void;
  failedToSendMessage?: string;
}

async function submitQueuedInput<TAttachment>(
  input: AgentInputSubmitActionInput<TAttachment>,
  held: PreparedDraftHold,
): Promise<AgentInputSubmitResult> {
  const revision = input.getDraftRevision();
  input.setIsProcessing(true);
  try {
    await input.queueMessage({ message: input.message.trim(), attachments: input.attachments });
    return "queued";
  } catch (error) {
    if (input.getDraftRevision() !== revision) held.fail(error);
    input.setSendError(
      error instanceof Error ? error.message : i18n.t("composer.errors.failedToSend"),
    );
    return "failed";
  }
}

function restoreOrRetainFailedInput<TAttachment>(
  input: AgentInputSubmitActionInput<TAttachment>,
  held: PreparedDraftHold,
  revision: unknown,
  error: unknown,
): void {
  if (input.getDraftRevision() !== revision) {
    held.fail(error);
    return;
  }
  if (input.submitBehavior === "preserve-and-lock") return;
  try {
    input.setUserInput(input.message.trim());
    input.setAttachments(input.attachments);
  } catch (restoreError) {
    held.fail(restoreError);
  }
}

async function submitDirectInput<TAttachment>(
  input: AgentInputSubmitActionInput<TAttachment>,
  held: PreparedDraftHold,
): Promise<AgentInputSubmitResult> {
  try {
    if (input.submitBehavior !== "preserve-and-lock") {
      input.setUserInput("");
      input.setAttachments([]);
    }
  } catch (error) {
    held.fail(error);
    input.setSendError(
      error instanceof Error ? error.message : i18n.t("composer.errors.failedToSend"),
    );
    return "failed";
  }
  const revision = input.getDraftRevision();
  input.setSendError(null);
  input.setIsProcessing(true);
  try {
    await input.submitMessage({ message: input.message.trim(), attachments: input.attachments });
  } catch (error) {
    restoreOrRetainFailedInput(input, held, revision, error);
    input.onSubmitError?.(error);
    input.setSendError(
      error instanceof Error
        ? error.message
        : (input.failedToSendMessage ?? i18n.t("composer.errors.failedToSend")),
    );
    return "failed";
  }
  if (input.getDraftRevision() === revision) input.clearDraft("sent");
  return "submitted";
}

export async function submitAgentInput<TAttachment>(
  input: AgentInputSubmitActionInput<TAttachment>,
): Promise<AgentInputSubmitResult> {
  if (
    !input.message.trim() &&
    input.attachments.length === 0 &&
    !input.hasExternalContent &&
    !input.allowEmptySubmit
  )
    return "noop";
  if (!input.canSubmit) return "noop";
  const held = input.recovery.prepare({ message: input.message, attachments: input.attachments });
  try {
    if (input.isAgentRunning && !input.forceSend) return await submitQueuedInput(input, held);
    return await submitDirectInput(input, held);
  } finally {
    held.release();
    input.setIsProcessing(false);
  }
}
