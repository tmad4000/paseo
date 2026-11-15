import type { ComposerAttachment } from "@/attachments/types";
import {
  collectWorkspaceAttachmentsForScopes,
  getWorkspaceAttachmentRevision,
  useWorkspaceAttachmentsStore,
} from "@/attachments/workspace-attachments-store";
import { getReviewDraftRevision } from "@/review/store";

export function createScopedDraftRevision(input: {
  getInputRevision: () => unknown;
  getAttachmentEditRevision?: () => unknown;
  scopeKeys: readonly string[];
  attachments?: readonly ComposerAttachment[];
}): () => unknown {
  const scopeKeys = [...new Set(input.scopeKeys.map((key) => key.trim()).filter(Boolean))];
  const reviewKeys = new Set<string>();
  let previous: unknown[] = [];
  let revision = {};
  return () => {
    const workspace = collectWorkspaceAttachmentsForScopes({
      attachmentsByScope: useWorkspaceAttachmentsStore.getState().attachmentsByScope,
      scopeKeys,
    });
    for (const attachment of [...(input.attachments ?? []), ...workspace]) {
      if (attachment.kind === "review") reviewKeys.add(attachment.reviewDraftKey);
    }
    const current = [
      input.getInputRevision(),
      input.getAttachmentEditRevision?.(),
      ...scopeKeys.map(getWorkspaceAttachmentRevision),
      ...[...reviewKeys].map(getReviewDraftRevision),
    ];
    if (
      current.length !== previous.length ||
      current.some((value, index) => value !== previous[index])
    ) {
      previous = current;
      revision = {};
    }
    return revision;
  };
}
