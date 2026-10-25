import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "pino";
import type { ClientDiagnosticEvent } from "@getpaseo/protocol/client-diagnostics";
import {
  ClientDiagnosticsStore,
  DEFAULT_CLIENT_DIAGNOSTICS_LIMITS,
  type ClientDiagnosticsLimits,
} from "./store.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "client-diagnostics-"));
  dirs.push(dir);
  return dir;
}

function fakeLogger() {
  const warn = vi.fn();
  return { logger: { warn } as unknown as Logger, warn };
}

const phone = {
  clientId: "cid-phone",
  deviceLabel: "iPhone",
  platform: "ios",
  appVersion: "0.10.0-beta.16",
};

function event(overrides: Partial<ClientDiagnosticEvent> = {}): ClientDiagnosticEvent {
  return {
    id: "cd-1",
    occurredAt: "2026-10-22T22:52:40.000Z",
    count: 1,
    source: "voice",
    severity: "error",
    message: "GPT Realtime rejected an event (invalid_value: bad audio). Microphone paused.",
    code: "realtime_state_error",
    operation: "realtime:unavailable",
    phase: "active",
    ...overrides,
  };
}

function store(
  dir = tempDir(),
  limits: Partial<ClientDiagnosticsLimits> = {},
  now: () => number = () => Date.parse("2026-10-22T23:00:00.000Z"),
) {
  const { logger, warn } = fakeLogger();
  const diagnostics = new ClientDiagnosticsStore(
    dir,
    logger,
    { ...DEFAULT_CLIENT_DIAGNOSTICS_LIMITS, persistDelayMs: 0, ...limits },
    now,
  );
  return { diagnostics, warn, dir };
}

describe("ClientDiagnosticsStore", () => {
  it("records a device diagnostic with its correlation fields and logs it once", () => {
    const { diagnostics, warn } = store();
    const result = diagnostics.record(phone, [event()]);
    expect(result).toEqual({ acknowledgedIds: ["cd-1"], deferredIds: [] });
    const [stored] = diagnostics.list();
    expect(stored).toMatchObject({
      id: "cd-1",
      source: "voice",
      code: "realtime_state_error",
      operation: "realtime:unavailable",
      clientId: "cid-phone",
      deviceLabel: "iPhone",
      platform: "ios",
      appVersion: "0.10.0-beta.16",
      message: "GPT Realtime rejected an event (invalid_value: bad audio). Microphone paused.",
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1]).toBe("client_diagnostic_reported");
    expect(warn.mock.calls[0][0]).toMatchObject({
      code: "realtime_state_error",
      clientId: "cid-phone",
    });
  });

  it("dedupes a retried id and merges a higher repeat count without logging again", () => {
    const { diagnostics, warn } = store();
    diagnostics.record(phone, [event()]);
    const again = diagnostics.record(phone, [
      event({ count: 4, lastOccurredAt: "2026-10-22T22:59:00.000Z" }),
    ]);
    expect(again.acknowledgedIds).toEqual(["cd-1"]);
    expect(diagnostics.list()).toHaveLength(1);
    expect(diagnostics.list()[0]).toMatchObject({
      count: 4,
      lastOccurredAt: "2026-10-22T22:59:00.000Z",
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("keeps the same id from different devices apart", () => {
    const { diagnostics } = store();
    diagnostics.record(phone, [event()]);
    diagnostics.record({ ...phone, clientId: "cid-laptop" }, [event()]);
    expect(diagnostics.list()).toHaveLength(2);
  });

  it("defers diagnostics past the per-device rate limit instead of dropping them silently", () => {
    const { diagnostics } = store(undefined, { maxPerWindow: 2 });
    const result = diagnostics.record(phone, [
      event({ id: "a" }),
      event({ id: "b" }),
      event({ id: "c" }),
    ]);
    expect(result).toEqual({ acknowledgedIds: ["a", "b"], deferredIds: ["c"] });
    expect(diagnostics.rateLimitedCount).toBe(1);
    // Another device has its own budget.
    expect(diagnostics.record({ ...phone, clientId: "other" }, [event({ id: "c" })])).toEqual({
      acknowledgedIds: ["c"],
      deferredIds: [],
    });
  });

  it("bounds history by count, age and serialized size", () => {
    let now = Date.parse("2026-10-22T23:00:00.000Z");
    const { diagnostics } = store(undefined, { maxEvents: 3, maxPerWindow: 1000 }, () => now);
    for (let i = 0; i < 5; i += 1) {
      diagnostics.record(phone, [event({ id: `e${i}`, occurredAt: new Date(now).toISOString() })]);
      now += 1000;
    }
    expect(diagnostics.list().map((e) => e.id)).toEqual(["e4", "e3", "e2"]);

    now += DEFAULT_CLIENT_DIAGNOSTICS_LIMITS.maxAgeMs + 1;
    expect(diagnostics.list()).toEqual([]);

    const small = store(undefined, { maxBytes: 1500, maxPerWindow: 1000 }).diagnostics;
    for (let i = 0; i < 10; i += 1) small.record(phone, [event({ id: `s${i}` })]);
    expect(Buffer.byteLength(JSON.stringify(small.list()))).toBeLessThanOrEqual(1500);
    expect(small.list()[0].id).toBe("s9");
  });

  it("persists across a daemon restart", async () => {
    const first = store();
    first.diagnostics.record(phone, [event()]);
    await first.diagnostics.flush();
    const second = store(first.dir);
    expect(second.diagnostics.list().map((e) => e.id)).toEqual(["cd-1"]);
  });

  it("filters by source and time, newest first", () => {
    const { diagnostics } = store();
    diagnostics.record(phone, [
      event({ id: "old", occurredAt: "2026-10-22T20:00:00.000Z", source: "toast" }),
      event({ id: "new", occurredAt: "2026-10-22T22:55:00.000Z", source: "voice" }),
    ]);
    expect(diagnostics.list().map((e) => e.id)).toEqual(["new", "old"]);
    expect(diagnostics.list({ source: "toast" }).map((e) => e.id)).toEqual(["old"]);
    expect(diagnostics.list({ since: "2026-10-22T22:00:00.000Z" }).map((e) => e.id)).toEqual([
      "new",
    ]);
    expect(diagnostics.list({ limit: 1 })).toHaveLength(1);
  });

  it("records host-observed voice failures under their own source", () => {
    const { diagnostics, warn } = store();
    diagnostics.recordHost({
      message: "GPT Realtime rejected an event (conversation_already_has_active_response: busy).",
      code: "conversation_already_has_active_response",
      operation: "rejected:response.create",
      phase: "connected/responding/conversation",
      agentId: "32725038-b2ca-4b45-aaef-a974af61f4fd",
      clientId: "cid-phone",
    });
    expect(diagnostics.list()[0]).toMatchObject({
      source: "host-voice",
      code: "conversation_already_has_active_response",
      operation: "rejected:response.create",
      clientId: "cid-phone",
    });
    expect(warn.mock.calls[0][1]).toBe("host_voice_diagnostic");
  });

  it("redacts what a device sends, even if the device did not", () => {
    const { diagnostics } = store();
    diagnostics.record(phone, [
      event({ message: "upstream said Authorization: Bearer abcdefghijklmnop12345 nope" }),
    ]);
    expect(diagnostics.list()[0].message).not.toContain("abcdefghijklmnop12345");
  });
});
