import type { ComposerAttachment } from "@/attachments/types";
import { retainAttachmentForGarbageCollection } from "@/attachments/gc-retention";
import { FailedPreparationRecovery, type SubmittedDraft } from "./preparation-recovery";

export function preparationRecoveryScopeKey(serverId: string, agentId: string): string {
  return JSON.stringify([serverId, agentId]);
}

export const failedPreparationRecovery = new FailedPreparationRecovery<ComposerAttachment>(
  (attachments) => {
    const releases: Array<() => void> = [];
    for (const attachment of attachments) {
      if (attachment.kind === "image")
        releases.push(retainAttachmentForGarbageCollection(attachment.metadata.id));
      if (attachment.kind === "browser_element" && attachment.attachment.screenshot) {
        releases.push(retainAttachmentForGarbageCollection(attachment.attachment.screenshot.id));
      }
    }
    return () => {
      for (const release of releases) release();
    };
  },
);

export interface RestorePreparationInput {
  id: string;
  scopeKey: string;
  getCurrentDraft: () => SubmittedDraft<ComposerAttachment>;
  apply: (draft: SubmittedDraft<ComposerAttachment>) => void;
  occupiedMessage: string;
}

export async function restoreFailedPreparation(input: RestorePreparationInput): Promise<void> {
  const entry = failedPreparationRecovery
    .getSnapshot()
    .find((candidate) => candidate.id === input.id && candidate.scopeKey === input.scopeKey);
  if (!entry) return;
  await failedPreparationRecovery.restore(entry.id, (draft) => {
    const current = input.getCurrentDraft();
    if (current.message.length > 0 || current.attachments.length > 0)
      throw new Error(input.occupiedMessage);
    input.apply(draft);
  });
}
