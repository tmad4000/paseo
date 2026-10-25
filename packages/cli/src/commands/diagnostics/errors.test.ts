import { describe, expect, it } from "vitest";

import {
  DIAGNOSTICS_COVERAGE_NOTE,
  parseSince,
  renderClientDiagnostics,
  type ClientDiagnosticsListing,
} from "./errors.js";

function listing(overrides: Partial<ClientDiagnosticsListing> = {}): ClientDiagnosticsListing {
  return {
    requestId: "r",
    events: [],
    rateLimited: 0,
    retention: { maxEvents: 1000, maxAgeDays: 14 },
    error: null,
    ...overrides,
  };
}

describe("renderClientDiagnostics", () => {
  it("shows what the phone saw with its code, operation, phase, agent and device", () => {
    const text = renderClientDiagnostics(
      listing({
        events: [
          {
            id: "host-1",
            occurredAt: "2026-10-22T22:52:41.000Z",
            count: 1,
            source: "host-voice",
            severity: "error",
            message:
              "GPT Realtime rejected an event (conversation_already_has_active_response: busy).",
            code: "conversation_already_has_active_response",
            operation: "rejected:response.create",
            phase: "connected/responding/conversation",
            agentId: "32725038-b2ca-4b45-aaef-a974af61f4fd",
            receivedAt: "2026-10-22T22:52:41.000Z",
            clientId: "cid_phone",
            deviceLabel: null,
            platform: null,
          },
          {
            id: "cd-1",
            occurredAt: "2026-10-22T22:52:40.000Z",
            lastOccurredAt: "2026-10-22T22:53:05.000Z",
            count: 3,
            source: "toast",
            severity: "error",
            message: "Voice failed to start",
            appVersion: "0.10.0-beta.16",
            receivedAt: "2026-10-22T22:55:00.000Z",
            clientId: "cid_phone",
            deviceLabel: "iPhone",
            platform: "ios",
          },
        ],
        rateLimited: 2,
      }),
    );
    expect(text).toContain("[host-voice error] host");
    expect(text).toContain("code=conversation_already_has_active_response");
    expect(text).toContain("op=rejected:response.create");
    expect(text).toContain("phase=connected/responding/conversation");
    expect(text).toContain("agent=32725038");
    expect(text).toContain("[toast error] iPhone");
    expect(text).toContain(" x3 since ");
    expect(text).toContain("app=0.10.0-beta.16");
    expect(text).toContain("2 reported diagnostic(s) were deferred");
    expect(text).toContain(DIAGNOSTICS_COVERAGE_NOTE);
  });

  it("says when nothing was recorded", () => {
    expect(renderClientDiagnostics(listing())).toContain("none recorded");
  });
});

describe("parseSince", () => {
  const now = Date.parse("2026-10-22T23:00:00.000Z");
  it("accepts relative durations and ISO timestamps", () => {
    expect(parseSince("30m", now)).toBe("2026-10-22T22:30:00.000Z");
    expect(parseSince("2h", now)).toBe("2026-10-22T21:00:00.000Z");
    expect(parseSince("1d", now)).toBe("2026-10-21T23:00:00.000Z");
    expect(parseSince("2026-10-22T22:51:00Z", now)).toBe("2026-10-22T22:51:00.000Z");
    expect(parseSince(undefined, now)).toBeUndefined();
  });

  it("rejects anything else with a clear message", () => {
    expect(() => parseSince("yesterday", now)).toThrow();
  });
});
