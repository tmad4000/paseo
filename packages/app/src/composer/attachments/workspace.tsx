import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type {
  ComposerAttachment,
  UserComposerAttachment,
  WorkspaceComposerAttachment,
} from "@/attachments/types";
import { getWorkspaceAttachmentPillContent } from "@/attachments/attachment-pill-content";
import { AttachmentLabel, AttachmentPill } from "@/components/attachment-pill";
import {
  isWorkspaceAttachment,
  isPullRequestContextAttachment,
  userAttachmentsOnly,
  workspaceAttachmentToSubmitAttachment,
} from "@/attachments/workspace-attachment-utils";
import {
  getAttachmentKey,
  hasWorkspaceAttachmentSnapshot,
  clearSubmittedWorkspaceAttachments,
  activeWorkspaceAttachments as selectActiveWorkspaceAttachments,
  removeWorkspaceAttachmentsMatching,
} from "./workspace-cleanup";

interface WorkspaceAttachmentBindingInput {
  normalAttachments: UserComposerAttachment[];
  workspaceAttachments: readonly WorkspaceComposerAttachment[];
  onOpenWorkspaceAttachment?: (attachment: WorkspaceComposerAttachment) => void;
}

interface RemoveWorkspaceAttachmentInput {
  selectedAttachments: readonly ComposerAttachment[];
  index: number;
}

interface OpenWorkspaceAttachmentInput {
  attachment: ComposerAttachment;
}

interface CompleteSubmitInput {
  result: "noop" | "queued" | "submitted" | "failed";
  outgoingAttachments: readonly ComposerAttachment[];
}

interface ComposerWorkspaceAttachmentBinding {
  selectedAttachments: ComposerAttachment[];
  buildOutgoingAttachments: (normalAttachments: UserComposerAttachment[]) => ComposerAttachment[];
  removeAttachment: (input: RemoveWorkspaceAttachmentInput) => boolean;
  openAttachment: (input: OpenWorkspaceAttachmentInput) => boolean;
  beginSubmit: (attachments: readonly ComposerAttachment[]) => void;
  clearSentAttachments: (attachments: readonly ComposerAttachment[]) => void;
  completeSubmit: (input: CompleteSubmitInput) => void;
  resetSuppression: () => void;
}

function getOpenAccessibilityLabel(
  attachment: WorkspaceComposerAttachment,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (attachment.kind === "browser_element") {
    return t("composer.attachments.openBrowserElement");
  }
  if (isPullRequestContextAttachment(attachment)) {
    return "Open context attachment";
  }
  if (attachment.kind === "chat_history") {
    return "Open chat history attachment";
  }
  return t("composer.attachments.openReview");
}

function getRemoveAccessibilityLabel(
  attachment: WorkspaceComposerAttachment,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (attachment.kind === "browser_element") {
    return t("composer.attachments.removeBrowserElement");
  }
  if (isPullRequestContextAttachment(attachment)) {
    return "Remove context attachment";
  }
  if (attachment.kind === "chat_history") {
    return "Remove chat history attachment";
  }
  return t("composer.attachments.removeReview");
}

function getPillTestID(attachment: WorkspaceComposerAttachment): string {
  if (attachment.kind === "chat_history") {
    return "composer-chat-history-attachment-pill";
  }
  return "composer-review-attachment-pill";
}

function renderPill(args: RenderWorkspaceAttachmentPillArgs): ReactElement {
  return (
    <WorkspaceAttachmentPill
      key={`workspace:${getAttachmentKey(args.attachment)}`}
      {...args}
      attachment={args.attachment}
    />
  );
}

function useWorkspaceAttachmentBinding({
  normalAttachments,
  workspaceAttachments,
  onOpenWorkspaceAttachment,
}: WorkspaceAttachmentBindingInput): ComposerWorkspaceAttachmentBinding {
  const [suppressedAttachments, setSuppressedAttachments] = useState<
    readonly WorkspaceComposerAttachment[]
  >([]);
  const activeWorkspaceAttachments = useMemo(
    () => selectActiveWorkspaceAttachments(workspaceAttachments, suppressedAttachments),
    [suppressedAttachments, workspaceAttachments],
  );

  const selectedAttachments = useMemo<ComposerAttachment[]>(
    () =>
      activeWorkspaceAttachments.length > 0
        ? [...normalAttachments, ...activeWorkspaceAttachments]
        : normalAttachments,
    [activeWorkspaceAttachments, normalAttachments],
  );

  useEffect(() => {
    setSuppressedAttachments((current) => {
      const next = current.filter((attachment) =>
        hasWorkspaceAttachmentSnapshot(workspaceAttachments, attachment),
      );
      return next.length === current.length ? current : next;
    });
  }, [workspaceAttachments]);

  const buildOutgoingAttachments = useCallback(
    (attachments: UserComposerAttachment[]): ComposerAttachment[] =>
      activeWorkspaceAttachments.length > 0
        ? [...attachments, ...activeWorkspaceAttachments]
        : attachments,
    [activeWorkspaceAttachments],
  );

  const suppressWorkspaceAttachment = useCallback((attachment: WorkspaceComposerAttachment) => {
    setSuppressedAttachments((current) =>
      hasWorkspaceAttachmentSnapshot(current, attachment) ? current : [...current, attachment],
    );
  }, []);

  const clearSentAttachments = clearSubmittedWorkspaceAttachments;

  const removeAttachment = useCallback(
    ({ selectedAttachments: current, index }: RemoveWorkspaceAttachmentInput) => {
      const selected = current[index];
      if (isWorkspaceAttachment(selected)) {
        if (
          selected.kind === "browser_element" ||
          selected.kind === "chat_history" ||
          isPullRequestContextAttachment(selected)
        ) {
          const selectedKey = getAttachmentKey(selected);
          removeWorkspaceAttachmentsMatching(selectedKey);
          return true;
        }
        suppressWorkspaceAttachment(selected);
        return true;
      }
      return false;
    },
    [suppressWorkspaceAttachment],
  );

  const openAttachment = useCallback(
    ({ attachment }: OpenWorkspaceAttachmentInput) => {
      if (!isWorkspaceAttachment(attachment) || attachment.kind !== "review") {
        return false;
      }
      onOpenWorkspaceAttachment?.(attachment);
      return true;
    },
    [onOpenWorkspaceAttachment],
  );

  const resetSuppression = useCallback(() => {
    setSuppressedAttachments([]);
  }, []);

  const beginSubmit = useCallback((attachments: readonly ComposerAttachment[]) => {
    const submitted = attachments.filter(isWorkspaceAttachment);
    if (submitted.length === 0) return;
    setSuppressedAttachments((current) => {
      const next = [...current];
      for (const attachment of submitted) {
        if (!hasWorkspaceAttachmentSnapshot(next, attachment)) next.push(attachment);
      }
      return next.length === current.length ? current : next;
    });
  }, []);

  const completeSubmit = useCallback(
    ({ result, outgoingAttachments }: CompleteSubmitInput) => {
      if (result === "submitted") {
        clearSentAttachments(outgoingAttachments);
      }
      if (result === "queued" || result === "submitted" || result === "failed") {
        resetSuppression();
      }
    },
    [clearSentAttachments, resetSuppression],
  );

  return {
    selectedAttachments,
    buildOutgoingAttachments,
    removeAttachment,
    openAttachment,
    beginSubmit,
    clearSentAttachments,
    completeSubmit,
    resetSuppression,
  };
}

interface RenderWorkspaceAttachmentPillArgs {
  attachment: WorkspaceComposerAttachment;
  index: number;
  disabled: boolean;
  onOpen: (attachment: ComposerAttachment) => void;
  onRemove: (index: number) => void;
}

interface WorkspaceAttachmentPillProps extends Omit<
  RenderWorkspaceAttachmentPillArgs,
  "attachment"
> {
  attachment: WorkspaceComposerAttachment;
}

function WorkspaceAttachmentPill({
  attachment,
  index,
  disabled,
  onOpen,
  onRemove,
}: WorkspaceAttachmentPillProps) {
  const { t } = useTranslation();
  const content = getWorkspaceAttachmentPillContent(attachment, t);
  const handleOpen = useCallback(() => {
    onOpen(attachment);
  }, [onOpen, attachment]);
  const handleRemove = useCallback(() => {
    onRemove(index);
  }, [onRemove, index]);
  return (
    <AttachmentPill
      testID={getPillTestID(attachment)}
      onOpen={handleOpen}
      onRemove={handleRemove}
      openAccessibilityLabel={getOpenAccessibilityLabel(attachment, t)}
      removeAccessibilityLabel={getRemoveAccessibilityLabel(attachment, t)}
      disabled={disabled}
    >
      <AttachmentLabel icon={content.icon} title={content.title} subtitle={content.subtitle} />
    </AttachmentPill>
  );
}

export const composerWorkspaceAttachment = {
  is: isWorkspaceAttachment,
  renderPill,
  toSubmitAttachment: workspaceAttachmentToSubmitAttachment,
  userAttachmentsOnly,
  useBinding: useWorkspaceAttachmentBinding,
};
