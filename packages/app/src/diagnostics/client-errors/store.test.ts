import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({ values: new Map<string, string>() }));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => storage.values.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      storage.values.set(key, value);
    },
    removeItem: async (key: string) => {
      storage.values.delete(key);
    },
  },
}));

const device = { deviceLabel: "iPhone", platform: "ios" };

async function loadModules() {
  vi.resetModules();
  const record = await import("./record");
  const store = await import("./store");
  return { ...record, ...store };
}

async function settle() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

function reporter(
  respond: (ids: string[]) => { acknowledgedIds: string[]; deferredIds: string[] } = (ids) => ({
    acknowledgedIds: ids,
    deferredIds: [],
  }),
) {
  const calls: Array<{
    deviceLabel?: string;
    events: Array<{ id: string; message: string; count: number }>;
  }> = [];
  return {
    calls,
    client: {
      reportClientDiagnostics: vi.fn(async (input: (typeof calls)[number]) => {
        calls.push(input);
        return respond(input.events.map((event) => event.id));
      }),
    },
  };
}

beforeEach(() => {
  storage.values.clear();
});

describe("client diagnostics queue", () => {
  it("keeps errors recorded before startup finished and saves them for later", async () => {
    const m = await loadModules();
    m.recordClientDiagnostic({ source: "global", message: "crashed during startup" });
    await m.installClientDiagnostics();
    m.recordClientDiagnostic({ source: "toast", message: "Could not reach host" });
    await settle();
    expect(m.useClientDiagnosticsStore.getState().entries.map((e) => e.message)).toEqual([
      "crashed during startup",
      "Could not reach host",
    ]);
    expect(storage.values.get("paseo-client-diagnostics")).toContain("Could not reach host");
  });

  it("survives an app restart while offline and is sent on the next reconnect", async () => {
    let m = await loadModules();
    await m.installClientDiagnostics();
    m.recordClientDiagnostic({
      source: "voice",
      message: "GPT Realtime rejected an event (invalid_value: bad audio).",
      code: "realtime_state_error",
      serverId: "srv_1",
    });
    await settle();

    // App killed and reopened, still offline: the saved queue is restored.
    m = await loadModules();
    await m.installClientDiagnostics();
    expect(m.useClientDiagnosticsStore.getState().entries).toHaveLength(1);

    // Reconnect: the host receives it once and the device forgets it.
    const host = reporter();
    await m.flushClientDiagnosticsForServer({ serverId: "srv_1", client: host.client, device });
    expect(host.calls).toHaveLength(1);
    expect(host.calls[0]).toMatchObject({ deviceLabel: "iPhone" });
    expect(host.calls[0].events[0]).toMatchObject({
      message: "GPT Realtime rejected an event (invalid_value: bad audio).",
      code: "realtime_state_error",
    });
    expect(host.calls[0].events[0]).not.toHaveProperty("serverId");
    expect(m.useClientDiagnosticsStore.getState().entries).toEqual([]);
  });

  it("keeps what the host deferred or never acknowledged, and survives a failed report", async () => {
    const m = await loadModules();
    await m.installClientDiagnostics();
    m.recordClientDiagnostic({ source: "toast", message: "first problem" });
    m.recordClientDiagnostic({ source: "toast", message: "second problem" });
    await settle();
    const [first, second] = m.useClientDiagnosticsStore.getState().entries;

    const limited = reporter(() => ({ acknowledgedIds: [first.id], deferredIds: [second.id] }));
    await m.flushClientDiagnosticsForServer({ serverId: "srv_1", client: limited.client, device });
    expect(m.useClientDiagnosticsStore.getState().entries.map((e) => e.id)).toEqual([second.id]);

    const failing = {
      reportClientDiagnostics: vi.fn(async () => {
        throw new Error("Host disconnected");
      }),
    };
    await expect(
      m.flushClientDiagnosticsForServer({ serverId: "srv_1", client: failing, device }),
    ).rejects.toThrow("Host disconnected");
    expect(m.useClientDiagnosticsStore.getState().entries.map((e) => e.id)).toEqual([second.id]);
  });

  it("sends host-specific diagnostics only to that host and runs one flush per host at a time", async () => {
    const m = await loadModules();
    await m.installClientDiagnostics();
    m.recordClientDiagnostic({ source: "rpc", message: "B timed out", serverId: "B" });
    await settle();

    const hostA = reporter();
    await m.flushClientDiagnosticsForServer({ serverId: "A", client: hostA.client, device });
    expect(hostA.calls).toHaveLength(0);

    const hostB = reporter();
    const flushes = [
      m.flushClientDiagnosticsForServer({ serverId: "B", client: hostB.client, device }),
      m.flushClientDiagnosticsForServer({ serverId: "B", client: hostB.client, device }),
    ];
    await Promise.all(flushes);
    expect(hostB.calls).toHaveLength(1);
  });

  it("tells listeners when a diagnostic is queued so a connected host gets it promptly", async () => {
    const m = await loadModules();
    await m.installClientDiagnostics();
    const listener = vi.fn();
    const unsubscribe = m.onClientDiagnosticQueued(listener);
    m.recordClientDiagnostic({ source: "toast", message: "Voice failed to start" });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    m.recordClientDiagnostic({ source: "toast", message: "another" });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("review follow-ups", () => {
  it("retries a rate-limited backlog on a stable connection with no new diagnostics", async () => {
    vi.useFakeTimers();
    try {
      const m = await loadModules();
      const { createClientDiagnosticsFlushScheduler, DIAGNOSTICS_RETRY_MIN_MS } =
        await import("./scheduler");
      await m.installClientDiagnostics();
      m.recordClientDiagnostic({ source: "toast", message: "first" });
      m.recordClientDiagnostic({ source: "toast", message: "second" });

      // The host's rate limit admits one now and defers the other until its window passes.
      let windowOpen = false;
      const host = reporter((ids) =>
        windowOpen
          ? { acknowledgedIds: ids, deferredIds: [] }
          : { acknowledgedIds: ids.slice(0, 1), deferredIds: ids.slice(1) },
      );
      const scheduler = createClientDiagnosticsFlushScheduler({
        flush: () =>
          m.flushClientDiagnosticsForServer({ serverId: "srv_1", client: host.client, device }),
      });
      scheduler.flushNow();
      await vi.advanceTimersByTimeAsync(0);
      expect(m.useClientDiagnosticsStore.getState().entries.map((e) => e.message)).toEqual([
        "second",
      ]);

      // Nothing new is recorded. The retry alone delivers the deferred diagnostic.
      windowOpen = true;
      await vi.advanceTimersByTimeAsync(DIAGNOSTICS_RETRY_MIN_MS);
      expect(host.calls).toHaveLength(2);
      expect(m.useClientDiagnosticsStore.getState().entries).toEqual([]);

      // Delivered: no further retries are scheduled.
      await vi.advanceTimersByTimeAsync(DIAGNOSTICS_RETRY_MIN_MS * 4);
      expect(host.calls).toHaveLength(2);
      scheduler.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops an expired backlog on load instead of uploading it after a restart", async () => {
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    storage.values.set(
      "paseo-client-diagnostics",
      JSON.stringify({
        state: {
          entries: [
            {
              id: "old-1",
              occurredAt: new Date(eightDaysAgo).toISOString(),
              count: 1,
              source: "toast",
              severity: "error",
              message: "from last week",
              fingerprint: "f",
              lastSeenMs: eightDaysAgo,
              claimedBy: "srv_gone",
            },
          ],
        },
        version: 1,
      }),
    );
    const m = await loadModules();
    await m.installClientDiagnostics();
    expect(m.useClientDiagnosticsStore.getState().entries).toEqual([]);
    const host = reporter();
    expect(
      await m.flushClientDiagnosticsForServer({ serverId: "srv_1", client: host.client, device }),
    ).toBe("delivered");
    expect(host.calls).toHaveLength(0);
  });

  it("sends an unassigned diagnostic to only one of two hosts flushing at once", async () => {
    const m = await loadModules();
    await m.installClientDiagnostics();
    m.recordClientDiagnostic({ source: "toast", message: "seen while offline" });

    let finishA!: (result: { acknowledgedIds: string[]; deferredIds: string[] }) => void;
    const hostA = {
      reportClientDiagnostics: vi.fn(
        (input: { events: Array<{ id: string }> }) =>
          new Promise<{ acknowledgedIds: string[]; deferredIds: string[] }>((resolve) => {
            finishA = resolve;
            void input;
          }),
      ),
    };
    const hostB = reporter();
    const flushA = m.flushClientDiagnosticsForServer({ serverId: "A", client: hostA, device });
    await m.flushClientDiagnosticsForServer({ serverId: "B", client: hostB.client, device });
    expect(hostA.reportClientDiagnostics).toHaveBeenCalledTimes(1);
    expect(hostB.calls).toHaveLength(0);

    // Host A does not acknowledge it: the claim is released and host B can take it.
    finishA({ acknowledgedIds: [], deferredIds: [] });
    expect(await flushA).toBe("deferred");
    await m.flushClientDiagnosticsForServer({ serverId: "B", client: hostB.client, device });
    expect(hostB.calls).toHaveLength(1);
    expect(m.useClientDiagnosticsStore.getState().entries).toEqual([]);
  });

  it("releases its claim when the report fails, so the diagnostic is not stranded", async () => {
    const m = await loadModules();
    await m.installClientDiagnostics();
    m.recordClientDiagnostic({ source: "toast", message: "unassigned" });
    const failing = {
      reportClientDiagnostics: vi.fn(async () => {
        throw new Error("socket closed");
      }),
    };
    await expect(
      m.flushClientDiagnosticsForServer({ serverId: "A", client: failing, device }),
    ).rejects.toThrow("socket closed");
    expect(m.useClientDiagnosticsStore.getState().entries[0]).not.toHaveProperty("claimedBy");
  });
});
