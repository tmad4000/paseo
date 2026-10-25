import { z } from "zod";

export const RedactionProfileSchema = z.object({
  include: z.object({ toolCalls: z.boolean(), reasoning: z.boolean(), errors: z.boolean() }),
  scrub: z.object({
    secrets: z.boolean(),
    hosts: z.boolean().optional(),
    paths: z.boolean(),
    contacts: z.boolean(),
  }),
  excludedMessageIds: z.array(z.string()).max(10000),
  extraPatterns: z.array(z.string().min(1).max(1000)).max(100),
});
export type RedactionProfile = z.infer<typeof RedactionProfileSchema>;
export const DEFAULT_REDACTION: RedactionProfile = {
  include: { toolCalls: false, reasoning: false, errors: false },
  scrub: { secrets: true, hosts: true, paths: true, contacts: true },
  excludedMessageIds: [],
  extraPatterns: [],
};
export const RedactionSummarySchema = z.object({
  hiddenToolCalls: z.number(),
  hiddenReasoning: z.number(),
  secretsMasked: z.number(),
  hostsMasked: z.number().optional(),
  pathsCollapsed: z.number(),
  contactsMasked: z.number(),
  messagesExcluded: z.number(),
});
export const SharedMessageSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("user"),
    id: z.string(),
    at: z.string(),
    author: z.object({ name: z.string(), role: z.enum(["owner", "participant"]) }),
    text: z.string(),
  }),
  z.object({ kind: z.literal("assistant"), id: z.string(), at: z.string(), text: z.string() }),
  z.object({
    kind: z.literal("omitted"),
    id: z.string(),
    at: z.string(),
    reason: z.enum(["tool_calls", "reasoning", "excluded"]),
    count: z.number(),
  }),
]);
export const ShareSnapshotSchema = z.object({
  sourceDigest: z.string().optional(),
  v: z.literal(1),
  title: z.string(),
  owner: z.object({ name: z.string() }),
  agent: z.object({ provider: z.string(), model: z.string().optional() }),
  createdAt: z.string(),
  messages: z.array(SharedMessageSchema),
  redactionSummary: RedactionSummarySchema,
});
export type ShareSnapshot = z.infer<typeof ShareSnapshotSchema>;
export type SharedMessage = z.infer<typeof SharedMessageSchema>;
export const ShareRecordPayloadSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  workspaceId: z.string().optional(),
  mode: z.literal("snapshot"),
  title: z.string(),
  redaction: RedactionProfileSchema,
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  snapshotSeqEnd: z.number().optional(),
  viewCount: z.number(),
  lastViewedAt: z.string().nullable(),
});
export type ShareRecordPayload = z.infer<typeof ShareRecordPayloadSchema>;
