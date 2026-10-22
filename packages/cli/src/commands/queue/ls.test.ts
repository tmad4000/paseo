import { describe, expect, it } from "vitest";

import { renderQueueInspection, type QueueInspection } from "./ls.js";

function inspection(overrides: Partial<QueueInspection> = {}): QueueInspection {
  return {
    requestId: "r",
    agentId: "agent-1",
    queue: { agentId: "agent-1", revision: 3, items: [] },
    drained: [],
    receipts: [],
    deviceReports: [],
    error: null,
    ...overrides,
  };
}

describe("renderQueueInspection", () => {
  it("separates what waits on the host, what was delivered, and what devices hold", () => {
    const text = renderQueueInspection(
      inspection({
        queue: {
          agentId: "agent-1",
          revision: 3,
          items: [{ id: "q1", text: "run the tests", createdAt: "2026-10-22T01:00:00Z" }],
        },
        drained: [{ id: "d1", drainedAt: "2026-10-22T00:00:00Z", preview: "check the logs" }],
        receipts: [{ messageId: "d1", state: "completed", createdAt: "2026-10-22T00:00:00Z" }],
        deviceReports: [
          {
            clientId: "phone-client",
            deviceLabel: "iPhone",
            platform: "ios",
            reportedAt: "2026-10-22T02:00:00Z",
            unsentQueued: 1,
            unsentDirect: 2,
            oldestCreatedAt: "2026-10-22T01:30:00Z",
          },
          {
            clientId: "desktop-client",
            deviceLabel: "Desktop app",
            platform: "desktop",
            reportedAt: "2026-10-22T02:00:00Z",
            unsentQueued: 0,
            unsentDirect: 0,
            oldestCreatedAt: null,
          },
        ],
      }),
      10,
    );

    expect(text).toContain("Queued on the host, waiting for the agent (1)");
    expect(text).toContain("q1");
    expect(text).toContain("run the tests");
    expect(text).toContain("check the logs");
    expect(text).toContain("submitted to the agent");
    expect(text).toContain("iPhone: 1 queued + 2 direct unsent");
    expect(text).toContain("1 other device(s) reported nothing unsent");
    expect(text).toContain("Only what reached this host is shown");
  });

  it("says plainly when nothing has been reported", () => {
    const text = renderQueueInspection(inspection(), 10);

    expect(text).toContain("none recorded");
    expect(text).toContain("no device has reported since the host started");
  });
});
