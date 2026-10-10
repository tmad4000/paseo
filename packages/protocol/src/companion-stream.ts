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

const common = {
  id: z.string(),
  timestamp: z.string(),
  text: z.string(),
  truncated: z.boolean(),
  ask: TrackedAskSchema.optional(),
  source: z
    .object({
      role: z.enum(["user", "agent"]),
      messageId: z.string(),
      seq: z.number().int().optional(),
      epoch: z.string().optional(),
      // Other provenance hashes the same message was observed under (server-maintained).
      aliases: z.array(z.string()).max(8).optional(),
    })
    .optional(),
  // Message coverage is not semantic extraction or task completion.
  messageReview: z
    .object({
      state: z.enum(["unreviewed", "reviewed"]),
      revision: z.number().int().min(0),
      note: z.string(),
      askIds: z.array(z.string()),
    })
    .optional(),
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
  }),
]);

export type CompanionEntry = z.infer<typeof CompanionEntrySchema>;

export function isCompanionEntryPending(entry: CompanionEntry): boolean {
  if (entry.messageReview) return entry.messageReview.state === "unreviewed";
  return (
    (entry.kind === "question" && entry.status !== "done") ||
    (entry.kind === "feature_request" && entry.status !== "done") ||
    (entry.kind === "permission" && entry.status === "pending")
  );
}

export function companionSourceRole(entry: CompanionEntry): "user" | "agent" | "unknown" {
  if (entry.source) return entry.source.role;
  if (entry.kind === "outcome" || entry.kind === "permission" || entry.id.startsWith("turn:"))
    return "agent";
  return "unknown";
}
