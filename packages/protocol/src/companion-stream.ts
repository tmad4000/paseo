import { z } from "zod";

/** Canonical source, not another copy of task/answer state. Always host-qualified. */
export const StreamReferenceSchema = z.object({
  serverId: z.string().min(1).max(200),
  agentId: z.string().min(1).max(200),
  entryId: z.string().min(1).max(300),
});
export const StreamSessionSchema = StreamReferenceSchema.omit({ entryId: true });
export const StreamInputRequestSchema = z.object({
  kind: z.enum(["input", "decision", "approval", "action"]),
  recipient: z.enum(["user", "agent", "external"]),
  /** Named person/agent when the recipient is not the account user. */
  recipientId: z.string().min(1).max(200).optional(),
  task: StreamReferenceSchema.optional(),
  subtaskId: z.string().min(1).max(200).optional(),
  sourceMessageId: z.string().min(1).max(200).optional(),
});
export type StreamReference = z.infer<typeof StreamReferenceSchema>;
export type StreamInputRequest = z.infer<typeof StreamInputRequestSchema>;

export const TrackedAskInputSchema = z.object({
  // COMPAT(streamWorkflow): added 2026-10-27; remove gate after 2027-04-27.
  /** Execution/provenance links; one canonical task can span multiple hosts and sessions. */
  sessions: z.array(StreamSessionSchema).max(100).optional(),
  /** Explicitly link an older duplicate to its canonical origin; never infer from matching text. */
  canonicalTask: StreamReferenceSchema.optional(),
  state: z.enum(["open", "in_progress", "blocked", "done"]),
  remaining: z.string().max(4000),
  evidence: z.string().max(4000),
  sourceMessageId: z.string().max(200).optional(),
  delegatedAgentId: z.string().max(200).optional(),
  subtasks: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        text: z.string().min(1).max(1000),
        done: z.boolean(),
      }),
    )
    .max(100)
    .optional(),
  // COMPAT(streamAnswers): fork feature; older hosts drop it.
  /** The ask is a question the user wants answered; it waits in Chat's answers pane. */
  expectsAnswer: z.boolean().optional(),
});
export const TrackedAskSchema = TrackedAskInputSchema.extend({
  /** Host-generated immutable identity. Legacy records receive an origin identity on read. */
  taskId: z.string().min(1).max(500).optional(),
  origin: StreamReferenceSchema.optional(),
  revision: z.number().int().min(1),
  provenance: z.literal("explicit"),
});
export type TrackedAskInput = z.infer<typeof TrackedAskInputSchema>;

/** A span of one timeline epoch's rows; a message is the projected range it was built from. */
export const TimelineAnchorSchema = z.object({
  epoch: z.string().max(200),
  startSeq: z.number().int().min(0),
  endSeq: z.number().int().min(0),
});

/**
 * An answer to a question the user asked, kept on that question's own Stream entry.
 * Explicit answers are written by an agent or person through set_stream_answer; a candidate is
 * the host's guess (the first settled reply after a tracked message), shown as unconfirmed and
 * replaced by any explicit answer. Each change bumps the revision.
 */
export const StreamReplySchema = z.object({
  text: z.string().max(4000),
  provenance: z.enum(["explicit", "candidate"]),
  revision: z.number().int().min(1),
  answeredAt: z.string(),
  /** The conversation that answered, when another chat (for example a delegated child) did. */
  answeredByAgentId: z.string().max(200).optional(),
  /** Where the reply sits in this chat's timeline; candidates always have one. */
  anchor: TimelineAnchorSchema.optional(),
  messageId: z.string().max(200).optional(),
});

const common = {
  id: z.string(),
  timestamp: z.string(),
  text: z.string(),
  truncated: z.boolean(),
  ask: TrackedAskSchema.optional(),
  // COMPAT(streamWorkflow): concrete input dependency, independent of execution and seen state.
  inputRequest: StreamInputRequestSchema.optional(),
  // COMPAT(streamTags): fork feature; lowercase #hashtags parsed from text. Older hosts omit it.
  tags: z.array(z.string()).optional(),
  // COMPAT(streamAnswers): fork feature; older hosts omit these.
  reply: StreamReplySchema.optional(),
  /** Personal review: the reply revision the user has seen. Independent of ask state. */
  replySeenRevision: z.number().int().min(0).optional(),
  // COMPAT(streamDefer): fork feature; older hosts omit it.
  /**
   * Personal review: when the user set this aside for later. Independent of status; the host
   * drops it when the entry is asked again, so a renewed request comes back on its own.
   */
  deferredAt: z.string().optional(),
  // COMPAT(streamSourceAnchors): fork feature; older hosts omit it.
  /**
   * Where in this chat's timeline the entry came from, so Show in chat can scroll there: the
   * named source message, or for a new ask without one, the user message the agent was
   * answering when it recorded the ask.
   */
  sourceAnchor: TimelineAnchorSchema.optional(),
};

export const CompanionEntrySchema = z.discriminatedUnion("kind", [
  z.object({
    ...common,
    kind: z.literal("question"),
    status: z.enum(["open", "reviewed", "done", "reply_sent"]),
  }),
  z.object({
    ...common,
    kind: z.literal("feature_request"),
    status: z.enum(["open", "reviewed", "done"]),
  }),
  z.object({
    ...common,
    kind: z.literal("permission"),
    requestId: z.string(),
    requestKind: z.enum(["tool", "plan", "question", "mode", "other"]),
    status: z.enum(["pending", "allowed", "denied", "expired"]),
  }),
  z.object({
    ...common,
    kind: z.literal("outcome"),
    status: z.enum(["completed", "failed", "canceled"]),
  }),
  z.object({
    ...common,
    kind: z.literal("pin"),
    sourceId: z.string().optional(),
  }),
  z.object({
    ...common,
    kind: z.literal("q_and_a"),
    answer: z.string().optional(),
    questionMessageId: z.string().optional(),
    answerMessageId: z.string().optional(),
    // COMPAT(streamAnswers): fork feature; older hosts omit these. done means stop tracking.
    status: z.enum(["open", "done"]).optional(),
    questionAnchor: TimelineAnchorSchema.optional(),
  }),
]);

export type CompanionEntry = z.infer<typeof CompanionEntrySchema>;
export type TimelineAnchor = z.infer<typeof TimelineAnchorSchema>;
export type StreamReply = z.infer<typeof StreamReplySchema>;
export type AnswerAttention = "waiting" | "new_answer" | "candidate";

/** Headline of an entry's text, used to recognise an ask phrased as a question. */
function headline(text: string): string {
  return (
    text
      .split("\n")
      .find((line) => line.trim())
      ?.trim() ?? ""
  );
}

/**
 * A question the user asked: a tracked Q&A message, or a tracked ask that expects an answer
 * (flagged, phrased as a question, or already answered). Agent questions to the user
 * (set_stream_question) are needed input, not user questions, and never count.
 */
export function isUserQuestionEntry(entry: CompanionEntry): boolean {
  if (entry.ask?.canonicalTask) return false;
  if (entry.kind === "q_and_a") return entry.status !== "done";
  if (entry.kind !== "question" || !entry.ask) return false;
  return Boolean(entry.reply || entry.ask.expectsAnswer || /[?？]$/.test(headline(entry.text)));
}

/**
 * Where a user question stands for its asker. An unseen reply revision needs attention, so a
 * revised answer is new again. Without a reply, an open ask or an anchored Q&A is waiting; a
 * finished ask without an answer is not (execution is not an answer), nor is an unanchored
 * Q&A record the host can never answer.
 */
export function getAnswerAttention(entry: CompanionEntry): AnswerAttention | null {
  if (!isUserQuestionEntry(entry)) return null;
  if (entry.reply) {
    if ((entry.replySeenRevision ?? 0) >= entry.reply.revision) return null;
    return entry.reply.provenance === "explicit" ? "new_answer" : "candidate";
  }
  if (entry.kind === "q_and_a") return entry.questionAnchor ? "waiting" : null;
  return entry.ask && entry.ask.state !== "done" ? "waiting" : null;
}

export function isCompanionEntryPending(entry: CompanionEntry): boolean {
  return (
    (entry.kind === "question" && entry.status !== "done") ||
    (entry.kind === "feature_request" && entry.status !== "done") ||
    (entry.kind === "permission" && entry.status === "pending")
  );
}

/** Human intervention only. A user's unanswered ask or unread result never belongs here. */
export function needsUserInput(entry: CompanionEntry): boolean {
  if (entry.ask || entry.kind === "q_and_a") return false;
  if (entry.kind === "permission") return entry.status === "pending";
  if (entry.kind !== "question" || entry.status === "done") return false;
  if (entry.inputRequest) return entry.inputRequest.recipient === "user";
  // Explicit legacy set_stream_question/manual inputs and expired provider questions only.
  // Prose-inferred outcome:<turn>:question candidates are not proven human obligations.
  return entry.id.startsWith("question:") || entry.id.startsWith("permission:");
}
