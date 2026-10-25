import { z } from "zod";
import { CompanionEntrySchema } from "./companion-stream.js";
import { describe, expect, it } from "vitest";
import {
  AgentSnapshotPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages.js";

describe("agent artifact snapshots", () => {
  it("parses global Stream requests and correlated mutation failures through the wire unions", () => {
    const read = { type: "stream.list.request", requestId: "read-1", filter: "pending", limit: 50 };
    expect(SessionInboundMessageSchema.parse(JSON.parse(JSON.stringify(read)))).toEqual(read);
    expect(SessionInboundMessageSchema.safeParse({ ...read, limit: 101 }).success).toBe(false);
    const write = {
      type: "stream.entry.update.request",
      requestId: "write-1",
      agentId: "agent-1",
      action: "add_question",
      entryId: "release",
      text: "Choose a channel",
    };
    expect(SessionInboundMessageSchema.parse(write)).toEqual(write);
    expect(
      SessionInboundMessageSchema.safeParse({ ...write, text: "x".repeat(4001) }).success,
    ).toBe(false);
    const rejection = {
      type: "stream.entry.update.response",
      payload: { requestId: "write-1", accepted: false, error: "Agent not found" },
    };
    expect(SessionOutboundMessageSchema.parse(rejection)).toEqual(rejection);
    const empty = {
      type: "stream.list.response",
      payload: { requestId: "read-1", rows: [], nextCursor: null, error: null },
    };
    expect(SessionOutboundMessageSchema.parse(empty)).toEqual(empty);
  });
  it("accepts additive per-agent artifacts", () => {
    const snapshot = AgentSnapshotPayloadSchema.parse({
      id: "agent-1",
      provider: "codex",
      cwd: "/tmp/project",
      model: null,
      createdAt: "2026-07-22T00:00:00.000Z",
      updatedAt: "2026-07-22T00:01:00.000Z",
      lastUserMessageAt: null,
      status: "idle",
      capabilities: {
        supportsStreaming: true,
        supportsSessionPersistence: true,
        supportsDynamicModes: true,
        supportsMcpServers: true,
        supportsReasoningStream: true,
        supportsToolInvocations: true,
      },
      currentModeId: null,
      availableModes: [],
      pendingPermissions: [],
      persistence: null,
      title: "Artifacts",
      labels: {},
      artifacts: [
        {
          path: "report.html",
          name: "report.html",
          kind: "html",
          mimeType: "text/html",
          size: 42,
          createdAt: "2026-07-22T00:00:30.000Z",
          updatedAt: "2026-07-22T00:00:30.000Z",
        },
      ],
    });

    expect(snapshot.messageActivity).toBeUndefined();
    const withActivity = {
      ...snapshot,
      messageActivity: {
        lastUserMessageAt: "2026-07-22T00:00:30.000Z",
        lastAssistantMessageAt: null,
      },
    };
    expect(AgentSnapshotPayloadSchema.parse(withActivity).messageActivity).toEqual(
      withActivity.messageActivity,
    );
    expect(AgentSnapshotPayloadSchema.omit({ messageActivity: true }).parse(withActivity)).toEqual(
      snapshot,
    );
    expect(snapshot.artifacts?.[0]?.path).toBe("report.html");
    expect(snapshot.companionEntries).toBeUndefined();
    const upgraded = {
      ...snapshot,
      companionEntries: [
        {
          id: "turn:one",
          kind: "outcome",
          status: "completed",
          text: "Report is ready",
          timestamp: "2026-09-21T12:00:00.000Z",
          truncated: false,
        },
      ],
    };
    expect(AgentSnapshotPayloadSchema.parse(upgraded).companionEntries).toEqual(
      upgraded.companionEntries,
    );
    // The previous wire shape ignores the additive field and still parses the snapshot.
    expect(AgentSnapshotPayloadSchema.omit({ companionEntries: true }).parse(upgraded)).toEqual(
      snapshot,
    );
  });
});

it("keeps tracked asks readable by the previous question schema", () => {
  const oldQuestion = z.object({
    id: z.string(),
    timestamp: z.string(),
    text: z.string(),
    truncated: z.boolean(),
    kind: z.literal("question"),
    status: z.enum(["open", "reviewed", "done", "reply_sent"]),
  });
  const entry = {
    id: "ask:deploy",
    timestamp: "2026-10-07T12:00:00Z",
    text: "Deploy",
    truncated: false,
    kind: "question",
    status: "open",
    ask: {
      state: "blocked",
      evidence: "Tests passed",
      remaining: "Approval",
      revision: 1,
      provenance: "explicit",
    },
  };
  expect(oldQuestion.parse(entry)).toEqual({
    id: entry.id,
    timestamp: entry.timestamp,
    text: "Deploy",
    truncated: false,
    kind: "question",
    status: "open",
  });
  expect(CompanionEntrySchema.parse(oldQuestion.parse(entry)).ask).toBeUndefined();
  expect(
    SessionInboundMessageSchema.parse({
      type: "stream.list.request",
      requestId: "page",
      agentId: "parent",
      asksOnly: true,
      limit: 50,
    }),
  ).toMatchObject({ agentId: "parent", asksOnly: true });
  expect(
    SessionInboundMessageSchema.parse({
      type: "stream.entry.update.request",
      requestId: "write",
      agentId: "parent",
      entryId: "deploy",
      action: "set_ask",
      text: "Deploy",
      expectedRevision: 0,
      ask: entry.ask,
    }),
  ).toMatchObject({ action: "set_ask", ask: { state: "blocked" } });
});
