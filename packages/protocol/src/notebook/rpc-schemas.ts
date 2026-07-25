import { z } from "zod";
import { NotebookAppendEntrySchema, NotebookEventSchema, WorkNotebookSchema } from "./types.js";

const NotebookRequestIdentitySchema = z.object({
  agentId: z.string().min(1),
  requestId: z.string().min(1),
});

export const AgentNotebookGetRequestSchema = NotebookRequestIdentitySchema.extend({
  type: z.literal("agent.notebook.get.request"),
  afterSequence: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().max(500).optional(),
});

export const AgentNotebookAppendRequestSchema = NotebookRequestIdentitySchema.extend({
  type: z.literal("agent.notebook.append.request"),
  expectedRevision: z.number().int().nonnegative(),
  entry: NotebookAppendEntrySchema,
});

const AgentNotebookErrorResultSchema = z.object({
  status: z.literal("error"),
  code: z.enum(["agent_not_found", "agent_archived", "invalid_target"]),
  message: z.string().min(1),
});

export const AgentNotebookGetResponseSchema = z.object({
  type: z.literal("agent.notebook.get.response"),
  payload: z.object({
    requestId: z.string().min(1),
    result: z.discriminatedUnion("status", [
      z.object({
        status: z.literal("found"),
        notebook: WorkNotebookSchema,
        events: z.array(NotebookEventSchema),
        hasMore: z.boolean(),
        writable: z.boolean(),
        readOnlyReason: z.literal("agent_archived").nullable(),
      }),
      AgentNotebookErrorResultSchema,
    ]),
  }),
});

export const AgentNotebookAppendResponseSchema = z.object({
  type: z.literal("agent.notebook.append.response"),
  payload: z.object({
    requestId: z.string().min(1),
    result: z.discriminatedUnion("status", [
      z.object({
        status: z.literal("applied"),
        notebook: WorkNotebookSchema,
        event: NotebookEventSchema,
      }),
      z.object({
        status: z.literal("conflict"),
        currentRevision: z.number().int().nonnegative(),
      }),
      AgentNotebookErrorResultSchema,
    ]),
  }),
});

export type AgentNotebookGetRequest = z.infer<typeof AgentNotebookGetRequestSchema>;
export type AgentNotebookAppendRequest = z.infer<typeof AgentNotebookAppendRequestSchema>;
export type AgentNotebookGetResponse = z.infer<typeof AgentNotebookGetResponseSchema>;
export type AgentNotebookAppendResponse = z.infer<typeof AgentNotebookAppendResponseSchema>;
