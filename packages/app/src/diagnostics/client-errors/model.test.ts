import { describe, expect, it } from "vitest";
import {
  addClientDiagnostic,
  applyClientDiagnosticAck,
  CLIENT_DIAGNOSTICS_COALESCE_MS,
  CLIENT_DIAGNOSTICS_MAX_AGE_MS,
  CLIENT_DIAGNOSTICS_MAX_PENDING,
  selectClientDiagnosticBatch,
  toWireDiagnostic,
  type PendingClientDiagnostic,
} from "./model";

const T0 = Date.parse("2026-10-22T22:52:00.000Z");

function letters(n: number): string {
  let text = "";
  let value = n;
  do {
    text = String.fromCharCode(97 + (value % 26)) + text;
    value = Math.floor(value / 26);
  } while (value > 0);
  return text;
}

function ids() {
  let n = 0;
  return () => `id-${(n += 1)}`;
}

describe("addClientDiagnostic", () => {
  it("captures a voice rejection with its correlation fields", () => {
    const [entry] = addClientDiagnostic(
      [],
      {
        source: "voice",
        message:
          "GPT Realtime rejected an event (invalid_value: bad audio). Microphone paused; retry or explicitly choose Paseo voice.",
        code: "realtime_state_error",
        operation: "realtime:unavailable",
        phase: "active",
        agentId: "agent-1",
        serverId: "srv_1",
        appVersion: "0.10.0-beta.16",
      },
      { now: T0, createId: ids() },
    );
    expect(entry).toMatchObject({
      id: "id-1",
      occurredAt: "2026-10-22T22:52:00.000Z",
      count: 1,
      source: "voice",
      severity: "error",
      code: "realtime_state_error",
      operation: "realtime:unavailable",
      phase: "active",
      agentId: "agent-1",
      serverId: "srv_1",
      appVersion: "0.10.0-beta.16",
    });
    expect(entry.message).toContain("(invalid_value: bad audio)");
  });

  it("counts repeats of the same problem on one event instead of flooding", () => {
    const createId = ids();
    let entries: PendingClientDiagnostic[] = [];
    for (let i = 0; i < 5; i += 1) {
      entries = addClientDiagnostic(
        entries,
        { source: "rpc", severity: "warning", code: "timeout", message: `Timed out after ${i}ms` },
        { now: T0 + i * 1000, createId },
      );
    }
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      count: 5,
      lastOccurredAt: new Date(T0 + 4000).toISOString(),
    });

    // After the coalescing window it is a new occurrence.
    entries = addClientDiagnostic(
      entries,
      { source: "rpc", severity: "warning", code: "timeout", message: "Timed out after 9ms" },
      { now: T0 + CLIENT_DIAGNOSTICS_COALESCE_MS + 5000, createId },
    );
    expect(entries).toHaveLength(2);
  });

  it("redacts secrets and audio before anything is stored on the device", () => {
    const audio = Buffer.alloc(200, 1).toString("base64");
    const [entry] = addClientDiagnostic(
      [],
      { source: "global", message: `failed with token=abc123secret and ${audio}` },
      { now: T0, createId: ids() },
    );
    expect(entry.message).not.toContain("abc123secret");
    expect(entry.message).not.toContain(audio);
  });

  it("keeps at most the newest diagnostics and forgets ones older than the age limit", () => {
    const createId = ids();
    let entries: PendingClientDiagnostic[] = [];
    for (let i = 0; i < CLIENT_DIAGNOSTICS_MAX_PENDING + 25; i += 1) {
      entries = addClientDiagnostic(
        entries,
        // Letters only: numbers are ignored when deciding two problems are the same.
        { source: "toast", message: `distinct problem ${letters(i)}` },
        { now: T0 + i, createId },
      );
    }
    expect(entries.length).toBeLessThanOrEqual(CLIENT_DIAGNOSTICS_MAX_PENDING);
    expect(entries.some((entry) => entry.id === "id-1")).toBe(false);

    const later = addClientDiagnostic(
      entries,
      { source: "toast", message: "after a week offline" },
      { now: T0 + CLIENT_DIAGNOSTICS_MAX_AGE_MS + 1000, createId },
    );
    expect(later).toHaveLength(1);
  });
});

describe("selectClientDiagnosticBatch / applyClientDiagnosticAck", () => {
  function queue(): PendingClientDiagnostic[] {
    const createId = ids();
    let entries: PendingClientDiagnostic[] = [];
    entries = addClientDiagnostic(
      entries,
      { source: "toast", message: "any host" },
      { now: T0, createId },
    );
    entries = addClientDiagnostic(
      entries,
      { source: "voice", message: "host A", serverId: "A" },
      { now: T0 + 1, createId },
    );
    entries = addClientDiagnostic(
      entries,
      { source: "voice", message: "host B", serverId: "B" },
      { now: T0 + 2, createId },
    );
    return entries;
  }

  it("sends a host its own diagnostics plus unassigned ones, oldest first", () => {
    expect(selectClientDiagnosticBatch(queue(), "A").map((entry) => entry.message)).toEqual([
      "any host",
      "host A",
    ]);
  });

  it("strips device-only bookkeeping from what goes on the wire", () => {
    const wire = toWireDiagnostic(queue()[1]);
    expect(wire).not.toHaveProperty("fingerprint");
    expect(wire).not.toHaveProperty("serverId");
    expect(wire).not.toHaveProperty("lastSeenMs");
  });

  it("forgets acknowledged entries but keeps unacknowledged and newly repeated ones", () => {
    const entries = queue();
    const sent = selectClientDiagnosticBatch(entries, "A");
    // While the report was in flight the first problem happened again.
    const repeated = structuredClone(entries);
    const again = repeated.find((entry) => entry.id === sent[0].id);
    if (again) again.count += 1;
    const after = applyClientDiagnosticAck(repeated, sent, [sent[0].id, sent[1].id]);
    expect(after.map((entry) => entry.message)).toEqual(["any host", "host B"]);
    expect(after[0].count).toBe(2);
  });
});
