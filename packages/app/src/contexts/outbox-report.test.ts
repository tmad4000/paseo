import { describe, expect, it } from "vitest";

import { buildOutboxReportAgents } from "./outbox-report";
import type { PendingQueueEnqueue } from "@/stores/queue-outbox-store/model";
import type { PendingDirectSend } from "@/stores/send-outbox-store/model";

function queued(overrides: Partial<PendingQueueEnqueue>): PendingQueueEnqueue {
  return {
    serverId: "server",
    agentId: "agent",
    itemId: "q",
    text: "",
    images: [],
    attachments: [],
    composerAttachments: [],
    createdAt: 0,
    attempts: 0,
    ...overrides,
  };
}

function direct(overrides: Partial<PendingDirectSend>): PendingDirectSend {
  return {
    serverId: "server",
    agentId: "agent",
    clientMessageId: "d",
    text: "",
    images: [],
    attachments: [],
    createdAt: 0,
    attempts: 0,
    ...overrides,
  };
}

describe("buildOutboxReportAgents", () => {
  it("counts unsent messages per agent for one host with the oldest time", () => {
    const report = buildOutboxReportAgents({
      serverId: "server",
      queued: [
        queued({ itemId: "q1", createdAt: Date.parse("2026-10-22T01:00:00Z") }),
        queued({ itemId: "q2", agentId: "other", createdAt: Date.parse("2026-10-22T03:00:00Z") }),
        queued({ itemId: "elsewhere", serverId: "another-host" }),
      ],
      direct: [direct({ clientMessageId: "d1", createdAt: Date.parse("2026-10-22T00:30:00Z") })],
    });

    expect(report).toEqual([
      {
        agentId: "agent",
        unsentQueued: 1,
        unsentDirect: 1,
        oldestCreatedAt: "2026-10-22T00:30:00.000Z",
      },
      {
        agentId: "other",
        unsentQueued: 1,
        unsentDirect: 0,
        oldestCreatedAt: "2026-10-22T03:00:00.000Z",
      },
    ]);
  });

  it("does not count a pending removal as an unsent message", () => {
    expect(
      buildOutboxReportAgents({
        serverId: "server",
        queued: [queued({ removalRequested: true })],
        direct: [],
      }),
    ).toEqual([]);
  });
});
