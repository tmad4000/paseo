// Decides when a live daemon worker is wedged rather than merely starved.
//
// Upstream #3263 removed the old 15-second heartbeat watchdog because heartbeat
// silence alone cannot tell a dead worker from one starved by a degraded host (for
// example after hibernation), and restarting starved workers destroyed live sessions.
// It left a permanently wedged worker with no automatic recovery, which is the failure
// seen on the M4: the worker froze natively (0% CPU, every runnable thread pinned)
// and stayed frozen for 45-70 minutes until someone killed it by hand.
//
// This detector only reports a stall when all of these hold:
// - the worker has reached readiness and has sent at least one heartbeat, so a worker
//   that is still bootstrapping, or an older worker that never sends heartbeats, is
//   never judged;
// - the worker has been silent for the whole threshold (minutes, not seconds);
// - the supervisor itself kept running on schedule during that time. If the
//   supervisor's own tick arrives late, the host was asleep or starved, and the
//   silence window restarts from that tick.

export const DEFAULT_WORKER_UNRESPONSIVE_RESTART_MS = 5 * 60_000;
export const DEFAULT_MAX_SUPERVISOR_TICK_GAP_MS = 5_000;
export const WORKER_UNRESPONSIVE_RESTART_ENV = "PASEO_WORKER_UNRESPONSIVE_RESTART_MS";

export interface WorkerStallDetectorOptions {
  /** Silence needed before the worker counts as wedged. 0 disables detection. */
  unresponsiveAfterMs: number;
  /** A supervisor tick later than this means the host itself was not running us. */
  maxSupervisorTickGapMs?: number;
  /** Monotonic clock in milliseconds. */
  now: () => number;
}

export type WorkerStallVerdict =
  | { stalled: false }
  | { stalled: true; silentForMs: number; lastHeartbeatAgoMs: number | null };

export interface WorkerStallDetector {
  markReady(): void;
  recordWorkerHeartbeat(): void;
  /** Called from the supervisor's periodic timer. */
  tick(): WorkerStallVerdict;
}

export function resolveWorkerUnresponsiveRestartMs(env: NodeJS.ProcessEnv): number {
  const raw = env[WORKER_UNRESPONSIVE_RESTART_ENV]?.trim();
  if (!raw) {
    return DEFAULT_WORKER_UNRESPONSIVE_RESTART_MS;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    return DEFAULT_WORKER_UNRESPONSIVE_RESTART_MS;
  }
  return Math.floor(value);
}

export function createWorkerStallDetector(
  options: WorkerStallDetectorOptions,
): WorkerStallDetector {
  const maxTickGapMs = options.maxSupervisorTickGapMs ?? DEFAULT_MAX_SUPERVISOR_TICK_GAP_MS;
  let ready = false;
  let lastHeartbeatAt: number | null = null;
  // Start of the current window in which the worker has been silent while the
  // supervisor demonstrably ran.
  let silenceWindowStartedAt: number | null = null;
  let lastTickAt: number | null = null;

  return {
    markReady() {
      ready = true;
      silenceWindowStartedAt = options.now();
    },
    recordWorkerHeartbeat() {
      const now = options.now();
      lastHeartbeatAt = now;
      silenceWindowStartedAt = now;
    },
    tick() {
      const now = options.now();
      const previousTickAt = lastTickAt;
      lastTickAt = now;

      if (
        options.unresponsiveAfterMs <= 0 ||
        !ready ||
        lastHeartbeatAt === null ||
        silenceWindowStartedAt === null
      ) {
        return { stalled: false };
      }
      if (previousTickAt !== null && now - previousTickAt > maxTickGapMs) {
        // The supervisor was not scheduled either: host sleep or starvation, not a
        // worker-specific wedge. Only count silence observed from here on.
        silenceWindowStartedAt = now;
        return { stalled: false };
      }
      const silentForMs = now - silenceWindowStartedAt;
      if (silentForMs < options.unresponsiveAfterMs) {
        return { stalled: false };
      }
      return {
        stalled: true,
        silentForMs,
        lastHeartbeatAgoMs: lastHeartbeatAt === null ? null : now - lastHeartbeatAt,
      };
    },
  };
}
