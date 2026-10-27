import { z } from "zod";

export const TrackedAskInputSchema = z.object({
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
});
export const TrackedAskSchema = TrackedAskInputSchema.extend({
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

const common = {
  id: z.string(),
  timestamp: z.string(),
  text: z.string(),
  truncated: z.boolean(),
  ask: TrackedAskSchema.optional(),
  // COMPAT(streamTags): fork feature; lowercase #hashtags parsed from text. Older hosts omit it.
  tags: z.array(z.string()).optional(),
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
    // COMPAT(streamAnswers): fork feature; older hosts omit these and never attach answers.
    /** Personal review of the current answer: reviewed means seen. Absent means open. */
    status: z.enum(["open", "reviewed", "done"]).optional(),
    questionAnchor: TimelineAnchorSchema.optional(),
    answerAnchor: TimelineAnchorSchema.optional(),
    answeredAt: z.string().optional(),
  }),
]);

export type CompanionEntry = z.infer<typeof CompanionEntrySchema>;
export type TimelineAnchor = z.infer<typeof TimelineAnchorSchema>;
export type QAndAEntry = Extract<CompanionEntry, { kind: "q_and_a" }>;
export type QAndAAttention = "waiting" | "new_answer";

/**
 * Where a tracked question stands for its asker: no answer yet, or an answer not yet seen.
 * Only anchored questions can be answered by the host; older unanchored Q&A records stay in
 * Stream without asking for attention.
 */
export function getQAndAAttention(entry: CompanionEntry): QAndAAttention | null {
  if (entry.kind !== "q_and_a" || entry.status === "done" || !entry.questionAnchor) return null;
  if (!entry.answer?.trim()) return "waiting";
  return entry.status === "reviewed" ? null : "new_answer";
}

export function isCompanionEntryPending(entry: CompanionEntry): boolean {
  return (
    (entry.kind === "question" && entry.status !== "done") ||
    (entry.kind === "feature_request" && entry.status !== "done") ||
    (entry.kind === "permission" && entry.status === "pending")
  );
}
