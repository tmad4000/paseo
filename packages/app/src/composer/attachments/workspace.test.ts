import { describe, expect, it } from "vitest";
import type { WorkspaceComposerAttachment } from "@/attachments/types";
import {
  buildDraftWorkspaceAttachmentScopeKey,
  resetWorkspaceAttachmentsStore,
  useWorkspaceAttachmentsStore,
} from "@/attachments/workspace-attachments-store";
import {
  buildReviewAttachmentSnapshot,
  useReviewDraftStore,
  resetReviewDraftStore,
  type ReviewDraftComment,
} from "@/review/store";
import type { ParsedDiffFile } from "@/git/use-diff-query";
import type { AgentAttachment } from "@getpaseo/protocol/messages";
import { dispatchComposerAgentMessage, queueComposerMessageOnServer } from "@/composer/actions";
import {
  activeWorkspaceAttachments,
  clearSubmittedWorkspaceAttachments,
  removeSentContextAttachments,
} from "./workspace-cleanup";

function chatHistoryAttachment(): WorkspaceComposerAttachment {
  return {
    kind: "chat_history",
    id: "chat_history:draft-1",
    attachment: {
      type: "text",
      mimeType: "text/plain",
      contextKind: "chat_history",
      title: "Chat history",
      text: "Previous chat.",
    },
    source: {
      serverId: "local",
      agentId: "agent-1",
    },
  };
}

function pullRequestContextAttachment(): WorkspaceComposerAttachment {
  return {
    kind: "github.pull_request_comment",
    id: "comment-1",
    title: "Comment",
    text: "Please check this.",
  };
}

function browserElementAttachment(): WorkspaceComposerAttachment {
  return {
    kind: "browser_element",
    attachment: {
      url: "https://example.com",
      selector: "button.primary",
      tag: "button",
      text: "Click me",
      outerHTML: '<button class="primary">Click me</button>',
      computedStyles: {},
      boundingRect: { x: 0, y: 0, width: 100, height: 40 },
      reactSource: null,
      parentChain: [],
      children: [],
      formatted: "button.primary\nClick me",
    },
  };
}

describe("workspace composer attachment cleanup", () => {
  it("clears sent scoped context attachments from their stores", () => {
    resetWorkspaceAttachmentsStore();
    const scopeKey = buildDraftWorkspaceAttachmentScopeKey("draft-1");
    const chatHistory = chatHistoryAttachment();
    const pullRequestContext = pullRequestContextAttachment();
    const browserElement = browserElementAttachment();
    useWorkspaceAttachmentsStore.getState().setWorkspaceAttachments({
      scopeKey,
      attachments: [chatHistory, pullRequestContext, browserElement],
    });

    removeSentContextAttachments([chatHistory, pullRequestContext, browserElement]);

    expect(useWorkspaceAttachmentsStore.getState().attachmentsByScope[scopeKey]).toBeUndefined();
  });
});

const reviewDiff: ParsedDiffFile = {
  path: "src/example.ts",
  isNew: false,
  isDeleted: false,
  additions: 1,
  deletions: 0,
  status: "ok",
  hunks: [
    {
      oldStart: 1,
      oldCount: 0,
      newStart: 1,
      newCount: 1,
      lines: [
        { type: "header", content: "@@ -1,0 +1,1 @@" },
        { type: "add", content: "const value = 1;" },
      ],
    },
  ],
};
const reviewKey = "review:submitted-snapshot";
function addReviewComment(id: string, body: string) {
  return useReviewDraftStore.getState().addComment({
    key: reviewKey,
    comment: { id, filePath: "src/example.ts", side: "new", lineNumber: 1, body },
  });
}
function currentReviewSnapshot() {
  return buildReviewAttachmentSnapshot({
    reviewDraftKey: reviewKey,
    cwd: "/repo",
    mode: "uncommitted",
    comments: useReviewDraftStore.getState().drafts[reviewKey] ?? [],
    diffFiles: [reviewDiff],
  });
}
function heldWrite() {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

type ReviewSnapshot = Extract<WorkspaceComposerAttachment, { kind: "review" }>;
type ReviewSubmitPath = "send" | "queue";
type ReviewPreparationStage = "encode" | "save";
const REVIEW_MUTATIONS = ["add", "edit", "aba", "discard", "replace", "unchanged"] as const;
interface ReviewSubmissionCase {
  route: ReviewSubmitPath;
  stage: ReviewPreparationStage;
  mutation: (typeof REVIEW_MUTATIONS)[number];
}
function reviewSubmissionCases(): ReviewSubmissionCase[] {
  const cases: ReviewSubmissionCase[] = [];
  for (const route of ["send", "queue"] as const) {
    for (const stage of ["encode", "save"] as const) {
      for (const mutation of REVIEW_MUTATIONS) cases.push({ route, stage, mutation });
    }
  }
  return cases;
}
function startReviewSubmission(
  route: ReviewSubmitPath,
  stage: ReviewPreparationStage,
  snapshot: ReviewSnapshot,
) {
  const pending = heldWrite();
  const entered = heldWrite();
  const hostAck = heldWrite();
  const saved: AgentAttachment[][] = [];
  const encodeImages = async () => {
    if (stage === "encode") {
      entered.resolve();
      await pending.promise;
    }
    return [];
  };
  const save = async (attachments: AgentAttachment[]) => {
    if (stage === "save") {
      entered.resolve();
      await pending.promise;
    }
    saved.push(attachments);
  };
  const flush = () => hostAck.promise;
  const promise =
    route === "send"
      ? dispatchComposerAgentMessage({
          client: {
            sendAgentMessage: async () => {
              throw new Error("Submission waited for host");
            },
            uploadFile: async () => ({ requestId: "unused", file: null, error: null }),
          },
          agentId: "agent",
          text: "review",
          attachments: [snapshot],
          encodeImages,
          submission: { begin: () => {}, accept: () => {}, reject: () => "rejected" },
          outbox: {
            serverId: "review-send",
            add: (entry) => save(entry.attachments),
            flush,
            get: () => undefined,
            remove: async () => {},
          },
        })
      : queueComposerMessageOnServer({
          client: {
            enqueueAgentMessage: async () => {
              throw new Error("Queue waited for host");
            },
            removeQueuedAgentMessage: async () => ({ agentId: "agent", revision: 1, items: [] }),
            getQueuedAgentMessageImages: async () => [],
          },
          agentId: "agent",
          text: "review",
          attachments: [snapshot],
          encodeImages,
          queue: { read: () => [], write: () => {} },
          applySnapshot: () => {},
          outbox: {
            serverId: "review-queue",
            add: (entry) => save(entry.attachments),
            flush,
            remove: async () => {},
          },
        });
  return { pending, entered, hostAck, saved, promise };
}

describe("submitted review cleanup", () => {
  it.each(reviewSubmissionCases())(
    "retains $mutation during $route $stage",
    async ({ route, stage, mutation }) => {
      resetReviewDraftStore();
      const original = addReviewComment("first", "comment 1");
      const sent = currentReviewSnapshot();
      if (!sent) throw new Error("Missing submitted review");
      const submission = startReviewSubmission(route, stage, sent);
      await submission.entered.promise;
      expect(submission.saved).toEqual([]);
      expect(activeWorkspaceAttachments([sent], [sent])).toEqual([]);
      const store = useReviewDraftStore.getState();
      switch (mutation) {
        case "add":
          addReviewComment("second", "comment 2");
          break;
        case "edit":
          store.updateComment({ key: reviewKey, id: "first", updates: { body: "new comment 1" } });
          break;
        case "aba":
          store.updateComment({
            key: reviewKey,
            id: "first",
            updates: { body: "temporary" },
            updatedAt: original.updatedAt,
          });
          store.updateComment({
            key: reviewKey,
            id: "first",
            updates: { body: "comment 1" },
            updatedAt: original.updatedAt,
          });
          break;
        case "discard":
          store.clearReview({ key: reviewKey });
          break;
        case "replace":
          store.deleteComment({ key: reviewKey, id: "first" });
          addReviewComment("second", "comment 2");
          break;
        case "unchanged":
          break;
      }
      const edited = currentReviewSnapshot();
      if (mutation !== "unchanged" && edited) {
        expect(activeWorkspaceAttachments([edited], [sent])).toEqual([edited]);
      }
      const changed = useReviewDraftStore.getState().drafts[reviewKey] ?? [];
      const expected: ReviewDraftComment[] = changed.filter((comment) => comment !== original);
      submission.pending.resolve();
      await submission.promise;
      clearSubmittedWorkspaceAttachments([sent]);
      expect(submission.saved).toEqual([[sent.attachment]]);
      expect(useReviewDraftStore.getState().drafts[reviewKey] ?? []).toEqual(expected);
      const retry = currentReviewSnapshot();
      if (expected.length > 0) {
        if (!retry) throw new Error("Newer review is not retryable");
        expect(retry.attachment.comments.map((comment) => comment.body)).toEqual(
          expected.map((comment) => comment.body),
        );
        expect(activeWorkspaceAttachments([retry], [sent])).toEqual([retry]);
      } else {
        expect(retry).toBeNull();
      }
      submission.hostAck.resolve();
    },
  );

  it("retains updated context attachments with the submitted key", () => {
    resetWorkspaceAttachmentsStore();
    const scopeKey = buildDraftWorkspaceAttachmentScopeKey("updated-context");
    const sent = pullRequestContextAttachment();
    const updated = { ...sent, text: "New unsent context" };
    useWorkspaceAttachmentsStore
      .getState()
      .setWorkspaceAttachments({ scopeKey, attachments: [updated] });
    clearSubmittedWorkspaceAttachments([sent]);
    expect(useWorkspaceAttachmentsStore.getState().attachmentsByScope[scopeKey]).toEqual([updated]);
    expect(activeWorkspaceAttachments([updated], [sent])).toEqual([updated]);
  });
});
