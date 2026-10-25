import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createClientDiagnosticsFlushScheduler,
  DIAGNOSTICS_RETRY_MAX_MS,
  DIAGNOSTICS_RETRY_MIN_MS,
  DIAGNOSTICS_TRIGGER_DELAY_MS,
  type ClientDiagnosticsFlushOutcome,
} from "./scheduler";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function sequence(...outcomes: Array<ClientDiagnosticsFlushOutcome | Error>) {
  const flush = vi.fn(async () => {
    const next = outcomes.length > 1 ? outcomes.shift()! : outcomes[0];
    if (next instanceof Error) throw next;
    return next;
  });
  return flush;
}

describe("createClientDiagnosticsFlushScheduler", () => {
  it("retries a deferred backlog with doubling backoff, capped", async () => {
    const flush = sequence("deferred");
    const scheduler = createClientDiagnosticsFlushScheduler({ flush });
    scheduler.flushNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(flush).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(DIAGNOSTICS_RETRY_MIN_MS);
    expect(flush).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(DIAGNOSTICS_RETRY_MIN_MS * 2 - 1);
    expect(flush).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(flush).toHaveBeenCalledTimes(3);
    // Far later the interval stays at the cap, so it never stops retrying while connected.
    await vi.advanceTimersByTimeAsync(DIAGNOSTICS_RETRY_MAX_MS * 3);
    const calls = flush.mock.calls.length;
    await vi.advanceTimersByTimeAsync(DIAGNOSTICS_RETRY_MAX_MS);
    expect(flush.mock.calls.length).toBe(calls + 1);
    scheduler.stop();
  });

  it("stops retrying once disconnected, and reconnect flushes again with a fresh backoff", async () => {
    const flush = sequence("deferred", "skipped", "delivered");
    const scheduler = createClientDiagnosticsFlushScheduler({ flush });
    scheduler.flushNow();
    await vi.advanceTimersByTimeAsync(DIAGNOSTICS_RETRY_MIN_MS);
    expect(flush).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(DIAGNOSTICS_RETRY_MAX_MS * 2);
    expect(flush).toHaveBeenCalledTimes(2);
    scheduler.flushNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(flush).toHaveBeenCalledTimes(3);
  });

  it("retries after a failed report and follows up quickly when more batches remain", async () => {
    const onError = vi.fn();
    const flush = sequence(new Error("socket closed"), "more", "delivered");
    const scheduler = createClientDiagnosticsFlushScheduler({ flush, onError });
    scheduler.flushNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(DIAGNOSTICS_RETRY_MIN_MS);
    expect(flush).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(DIAGNOSTICS_TRIGGER_DELAY_MS);
    expect(flush).toHaveBeenCalledTimes(3);
  });

  it("debounces bursts of new diagnostics into one flush and cancels everything on stop", async () => {
    const flush = sequence("deferred");
    const scheduler = createClientDiagnosticsFlushScheduler({ flush });
    scheduler.trigger();
    scheduler.trigger();
    scheduler.trigger();
    await vi.advanceTimersByTimeAsync(DIAGNOSTICS_TRIGGER_DELAY_MS);
    expect(flush).toHaveBeenCalledTimes(1);
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(DIAGNOSTICS_RETRY_MAX_MS * 2);
    scheduler.trigger();
    await vi.advanceTimersByTimeAsync(DIAGNOSTICS_RETRY_MAX_MS);
    expect(flush).toHaveBeenCalledTimes(1);
  });
});
