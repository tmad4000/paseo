import { z } from "zod";
import type { AgentArtifact } from "../agent-types.js";

export const WorkNotebookSchema = z.object({
  id: z.string().min(1),
  agentId: z.string().min(1),
  scope: z.literal("session"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  revision: z.number().int().nonnegative(),
  lastSequence: z.number().int().nonnegative(),
});

export const NotebookEventAuthorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("user"),
    id: z.string().min(1).optional(),
  }),
  z.object({
    kind: z.literal("agent"),
    id: z.string().min(1),
  }),
  z.object({
    kind: z.literal("system"),
  }),
]);

const NotebookEventEnvelopeSchema = z.object({
  id: z.string().min(1),
  notebookId: z.string().min(1),
  sequence: z.number().int().positive(),
  createdAt: z.string().datetime(),
  author: NotebookEventAuthorSchema,
});

// Kept wire-compatible with AgentArtifactSchema without importing messages.ts, which owns
// the notebook RPC union and would create a runtime schema cycle.
export const NotebookArtifactSchema: z.ZodType<AgentArtifact> = z.object({
  path: z.string(),
  name: z.string(),
  kind: z.enum(["html", "markdown", "image", "svg", "pdf", "diff"]),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const NotebookEventSchema = z.discriminatedUnion("kind", [
  NotebookEventEnvelopeSchema.extend({
    kind: z.literal("note_added"),
    markdown: z.string().min(1),
  }),
  NotebookEventEnvelopeSchema.extend({
    kind: z.literal("question_opened"),
    markdown: z.string().min(1),
  }),
  NotebookEventEnvelopeSchema.extend({
    kind: z.literal("question_resolved"),
    targetEventId: z.string().min(1),
  }),
  NotebookEventEnvelopeSchema.extend({
    kind: z.literal("question_reopened"),
    targetEventId: z.string().min(1),
  }),
  NotebookEventEnvelopeSchema.extend({
    kind: z.literal("item_pinned"),
    targetEventId: z.string().min(1),
  }),
  NotebookEventEnvelopeSchema.extend({
    kind: z.literal("item_unpinned"),
    targetEventId: z.string().min(1),
  }),
  NotebookEventEnvelopeSchema.extend({
    kind: z.literal("link_captured"),
    url: z.string().url(),
    source: z.object({
      agentId: z.string().min(1),
      timelineSequence: z.number().int().positive(),
      messageId: z.string().min(1).optional(),
      role: z.enum(["user", "assistant"]),
    }),
  }),
  NotebookEventEnvelopeSchema.extend({
    kind: z.literal("artifact_observed"),
    artifact: NotebookArtifactSchema,
    source: z.object({
      agentId: z.string().min(1),
    }),
  }),
]);

export const NotebookAppendEntrySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("note_added"),
    markdown: z.string().trim().min(1).max(20_000),
  }),
  z.object({
    kind: z.literal("question_opened"),
    markdown: z.string().trim().min(1).max(20_000),
  }),
  z.object({
    kind: z.literal("question_resolved"),
    targetEventId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("question_reopened"),
    targetEventId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("item_pinned"),
    targetEventId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("item_unpinned"),
    targetEventId: z.string().min(1),
  }),
]);

export const StoredWorkNotebookSchema = z.object({
  notebook: WorkNotebookSchema,
  events: z.array(NotebookEventSchema),
});

export type WorkNotebook = z.infer<typeof WorkNotebookSchema>;
export type NotebookEventAuthor = z.infer<typeof NotebookEventAuthorSchema>;
export type NotebookEvent = z.infer<typeof NotebookEventSchema>;
export type NotebookAppendEntry = z.infer<typeof NotebookAppendEntrySchema>;
export type StoredWorkNotebook = z.infer<typeof StoredWorkNotebookSchema>;
