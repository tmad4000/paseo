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
