import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "./test-utils/paseo-daemon.js";
import { DaemonClient } from "./test-utils/daemon-client.js";

/**
 * Round trip through a real daemon: a device reports the errors it saw, and another client
 * (what `paseo diagnostics errors` uses) reads them back with device correlation and redaction.
 */
describe("client error diagnostics", () => {
  let daemon: TestPaseoDaemon;
  const clients: DaemonClient[] = [];

  beforeEach(async () => {
    daemon = await createTestPaseoDaemon();
  });

  afterEach(async () => {
    for (const client of clients.splice(0)) await client.close().catch(() => {});
    await daemon.close();
  }, 30000);

  async function connect(options: { clientId?: string; appVersion?: string } = {}) {
    const client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      clientId: options.clientId,
      appVersion: options.appVersion,
    });
    clients.push(client);
    await client.connect();
    return client;
  }

  test("a device's reported errors are readable by another client, deduped and redacted", async () => {
    const phone = await connect({ clientId: "cid_phone_e2e", appVersion: "0.10.0-beta.16" });
    expect(phone.getLastServerInfoMessage()?.features?.clientDiagnostics).toBe(true);

    const rejection = {
      id: "cd-e2e-1",
      occurredAt: "2026-10-22T22:52:40.000Z",
      count: 1,
      source: "voice" as const,
      severity: "error" as const,
      message:
        "GPT Realtime rejected an event (invalid_value: bad request). Microphone paused; key sk-proj-abcdefghijklmnop12345",
      code: "realtime_state_error",
      operation: "realtime:unavailable",
      phase: "active",
      agentId: "32725038-b2ca-4b45-aaef-a974af61f4fd",
    };
    const first = await phone.reportClientDiagnostics({
      deviceLabel: "iPhone",
      platform: "ios",
      events: [rejection],
    });
    expect(first).toEqual({ acknowledgedIds: ["cd-e2e-1"], deferredIds: [] });

    // A retry after a lost acknowledgement, now with more repeats, merges instead of duplicating.
    const retry = await phone.reportClientDiagnostics({
      deviceLabel: "iPhone",
      platform: "ios",
      events: [{ ...rejection, count: 3, lastOccurredAt: "2026-10-22T22:53:05.000Z" }],
    });
    expect(retry.acknowledgedIds).toEqual(["cd-e2e-1"]);

    const reader = await connect();
    const listing = await reader.listClientDiagnostics({ source: "voice" });
    expect(listing.error).toBeNull();
    expect(listing.events).toHaveLength(1);
    const [stored] = listing.events;
    expect(stored).toMatchObject({
      id: "cd-e2e-1",
      count: 3,
      lastOccurredAt: "2026-10-22T22:53:05.000Z",
      code: "realtime_state_error",
      operation: "realtime:unavailable",
      clientId: "cid_phone_e2e",
      deviceLabel: "iPhone",
      platform: "ios",
      appVersion: "0.10.0-beta.16",
    });
    expect(stored.message).toContain("GPT Realtime rejected an event (invalid_value: bad request)");
    expect(stored.message).not.toContain("abcdefghijklmnop12345");
    expect(listing.retention.maxEvents).toBeGreaterThan(0);

    // Filters reach the host.
    expect((await reader.listClientDiagnostics({ source: "toast" })).events).toEqual([]);
    expect(
      (await reader.listClientDiagnostics({ since: "2026-10-22T23:00:00.000Z" })).events,
    ).toEqual([]);
  });
});
