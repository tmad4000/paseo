import { z } from "zod";
import { AgentArtifactSchema } from "./agent-artifact.js";
import { CompanionEntrySchema, TrackedAskInputSchema } from "./companion-stream.js";

export const StreamFilterSchema = z.enum(["all", "pending", "pinned"]);
export const StreamRowSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  agentTitle: z.string(),
  cwd: z.string(),
  workspaceId: z.string().optional(),
  archived: z.boolean(),
  timestamp: z.string(),
  item: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("entry"), entry: CompanionEntrySchema }),
    z.object({ kind: z.literal("artifact"), artifact: AgentArtifactSchema }),
  ]),
});
export const StreamListRequestSchema = z.object({
  type: z.literal("stream.list.request"),
  requestId: z.string(),
  filter: StreamFilterSchema.optional(),
  agentId: z.string().optional(),
  asksOnly: z.boolean().optional(),
  includeMessageInventory: z.boolean().optional(),
  sourceRole: z.enum(["all", "user", "agent"]).optional(),
  state: z.enum(["all", "open", "done"]).optional(),
  search: z.string().max(1000).optional(),
  includeArchived: z.boolean().optional(),
  cursor: z.string().max(10000).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});
export const StreamListResponseSchema = z.object({
  type: z.literal("stream.list.response"),
  payload: z.object({
    requestId: z.string(),
    rows: z.array(StreamRowSchema),
    nextCursor: z.string().nullable(),
    error: z.string().nullable(),
    counts: z
      .object({
        total: z.number(),
        open: z.number(),
        done: z.number(),
        user: z.number(),
        agent: z.number(),
        unknown: z.number(),
        matching: z.number(),
      })
      .optional(),
    coverage: z.enum(["loaded_history", "not_loaded"]).optional(),
  }),
});
export const StreamUpdateRequestSchema = z.object({
  type: z.literal("stream.entry.update.request"),
  requestId: z.string(),
  agentId: z.string(),
  entryId: z.string().optional(),
  action: z.enum([
    "update_status",
    "add_pin",
    "remove_pin",
    "add_q_and_a",
    "add_question",
    "set_ask",
    "review_message",
  ]),
  status: z.enum(["open", "reviewed", "done"]).optional(),
  text: z.string().max(4000).optional(),
  ask: TrackedAskInputSchema.optional(),
  expectedRevision: z.number().int().min(0).optional(),
  answerText: z.string().max(4000).optional(),
  sourceId: z.string().optional(),
  review: z
    .object({
      state: z.enum(["unreviewed", "reviewed"]),
      note: z.string().max(4000),
      askIds: z.array(z.string().max(200)).max(100),
    })
    .optional(),
});
export const StreamUpdateResponseSchema = z.object({
  type: z.literal("stream.entry.update.response"),
  payload: z.object({ requestId: z.string(), accepted: z.boolean(), error: z.string().optional() }),
});
export type StreamRow = z.infer<typeof StreamRowSchema>;
export type StreamFilter = z.infer<typeof StreamFilterSchema>;
export type StreamListOptions = Omit<z.infer<typeof StreamListRequestSchema>, "type" | "requestId">;
export type StreamEntryUpdate = Omit<
  z.infer<typeof StreamUpdateRequestSchema>,
  "type" | "requestId"
>;
