/**
 * What one flush of the device queue to a host achieved:
 * - `delivered`: nothing this host should receive remains;
 * - `more`: a batch went through but more remain (batch limit reached);
 * - `deferred`: the host refused some for rate limiting, or acknowledged nothing;
 * - `skipped`: not attempted (not connected, host lacks the feature, queue not loaded).
 */
export type ClientDiagnosticsFlushOutcome = "delivered" | "more" | "deferred" | "skipped";

export const DIAGNOSTICS_TRIGGER_DELAY_MS = 2_000;
export const DIAGNOSTICS_RETRY_MIN_MS = 15_000;
export const DIAGNOSTICS_RETRY_MAX_MS = 10 * 60_000;

interface Timers {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface ClientDiagnosticsFlushScheduler {
  /** A new diagnostic was queued: flush soon (debounced). */
  trigger(): void;
  /** Flush now, e.g. on (re)connect. Resets the retry backoff. */
  flushNow(): void;
  /** Cancels any pending flush; call on disconnect handling and unmount. */
  stop(): void;
}

/**
 * Keeps a connected host's backlog moving without new diagnostics arriving: a deferred or failed
 * flush is retried with exponential backoff (15 s doubling to 10 min) for as long as the host stays
 * connected. A skipped flush (disconnected) stops retrying; the next reconnect flushes again.
 */
export function createClientDiagnosticsFlushScheduler(input: {
  flush: () => Promise<ClientDiagnosticsFlushOutcome>;
  timers?: Timers;
  onError?: (error: unknown) => void;
}): ClientDiagnosticsFlushScheduler {
  const timers: Timers = input.timers ?? {
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  let timer: unknown = null;
  let retryDelay = DIAGNOSTICS_RETRY_MIN_MS;
  let running = false;
  let rerun = false;
  let stopped = false;

  const schedule = (ms: number) => {
    if (stopped) return;
    if (timer !== null) timers.clearTimeout(timer);
    timer = timers.setTimeout(() => {
      timer = null;
      void run();
    }, ms);
  };

  const retryLater = () => {
    schedule(retryDelay);
    retryDelay = Math.min(retryDelay * 2, DIAGNOSTICS_RETRY_MAX_MS);
  };

  const run = async (): Promise<void> => {
    if (stopped) return;
    if (running) {
      rerun = true;
      return;
    }
    running = true;
    try {
      const outcome = await input.flush();
      if (outcome === "delivered" || outcome === "skipped") retryDelay = DIAGNOSTICS_RETRY_MIN_MS;
      if (outcome === "more") schedule(DIAGNOSTICS_TRIGGER_DELAY_MS);
      if (outcome === "deferred") retryLater();
    } catch (error) {
      input.onError?.(error);
      retryLater();
    } finally {
      running = false;
      if (rerun) {
        rerun = false;
        void run();
      }
    }
  };

  return {
    trigger() {
      if (stopped || timer !== null) return;
      schedule(DIAGNOSTICS_TRIGGER_DELAY_MS);
    },
    flushNow() {
      stopped = false;
      retryDelay = DIAGNOSTICS_RETRY_MIN_MS;
      if (timer !== null) {
        timers.clearTimeout(timer);
        timer = null;
      }
      void run();
    },
    stop() {
      stopped = true;
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
    },
  };
}
