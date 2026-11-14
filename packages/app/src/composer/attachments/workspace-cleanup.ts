import type { ComposerAttachment, WorkspaceComposerAttachment } from "@/attachments/types";
import { useWorkspaceAttachmentsStore } from "@/attachments/workspace-attachments-store";
import { clearSubmittedReviewAttachment } from "@/review/store";
import { isPullRequestContextAttachment } from "@/attachments/workspace-attachment-utils";

export function getAttachmentKey(attachment: WorkspaceComposerAttachment): string {
  if (attachment.kind === "browser_element") {
    return JSON.stringify({
      type: "browser_element",
      url: attachment.attachment.url,
      selector: attachment.attachment.selector,
      tag: attachment.attachment.tag,
      text: attachment.attachment.text,
      html: attachment.attachment.outerHTML,
      comment: attachment.attachment.comment ?? null,
    });
  }
  if (isPullRequestContextAttachment(attachment)) {
    return JSON.stringify({
      kind: attachment.kind,
      id: attachment.id,
    });
  }
  if (attachment.kind === "chat_history") {
    return JSON.stringify({
      kind: attachment.kind,
      id: attachment.id,
    });
  }
  return JSON.stringify({
    type: "review",
    cwd: attachment.attachment.cwd,
    mode: attachment.attachment.mode,
    baseRef: attachment.attachment.baseRef ?? null,
    reviewDraftKey: attachment.reviewDraftKey,
    comments: attachment.attachment.comments.map((comment) => ({
      filePath: comment.filePath,
      side: comment.side,
      lineNumber: comment.lineNumber,
      body: comment.body,
    })),
  });
}

export function removeWorkspaceAttachmentsMatching(selectedKey: string): void {
  const { attachmentsByScope, setWorkspaceAttachments } = useWorkspaceAttachmentsStore.getState();
  for (const [scopeKey, attachments] of Object.entries(attachmentsByScope)) {
    const nextAttachments = attachments.filter(
      (attachment) => getAttachmentKey(attachment) !== selectedKey,
    );
    if (nextAttachments.length !== attachments.length) {
      setWorkspaceAttachments({ scopeKey, attachments: nextAttachments });
    }
  }
}

function isSentContextAttachment(
  attachment: ComposerAttachment,
): attachment is WorkspaceComposerAttachment {
  return (
    attachment.kind === "browser_element" ||
    attachment.kind === "chat_history" ||
    isPullRequestContextAttachment(attachment)
  );
}

export function removeSentContextAttachments(attachments: readonly ComposerAttachment[]): void {
  const submitted = new Set(attachments.filter(isSentContextAttachment));
  const store = useWorkspaceAttachmentsStore.getState();
  for (const [scopeKey, current] of Object.entries(store.attachmentsByScope)) {
    const remaining = current.filter((attachment) => !submitted.has(attachment));
    if (remaining.length !== current.length) {
      store.setWorkspaceAttachments({ scopeKey, attachments: remaining });
    }
  }
}

export function clearSubmittedWorkspaceAttachments(
  attachments: readonly ComposerAttachment[],
): void {
  for (const attachment of attachments) {
    if (attachment.kind === "review") clearSubmittedReviewAttachment(attachment);
  }
  removeSentContextAttachments(attachments);
}

export function activeWorkspaceAttachments(
  attachments: readonly WorkspaceComposerAttachment[],
  suppressed: readonly WorkspaceComposerAttachment[],
): WorkspaceComposerAttachment[] {
  return attachments.filter((attachment) => !suppressed.includes(attachment));
}
