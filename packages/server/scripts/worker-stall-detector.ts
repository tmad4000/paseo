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
  monotonicNow: () => number;
  wallNow: () => number;
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
  let silentForMs = 0;
  let lastMonoAt = options.monotonicNow();
  let lastWallAt = options.wallNow();

  function resetWindow() {
    silentForMs = 0;
    lastMonoAt = options.monotonicNow();
    lastWallAt = options.wallNow();
  }

  return {
    markReady() {
      ready = true;
      resetWindow();
    },
    recordWorkerHeartbeat() {
      resetWindow();
      lastHeartbeatAt = lastMonoAt;
    },
    tick() {
      const monoNow = options.monotonicNow();
      const wallNow = options.wallNow();
      const monoDelta = monoNow - lastMonoAt;
      const wallDelta = wallNow - lastWallAt;
      lastMonoAt = monoNow;
      lastWallAt = wallNow;

      if (options.unresponsiveAfterMs <= 0 || !ready || lastHeartbeatAt === null) {
        return { stalled: false };
      }
      if (wallDelta < 0 || monoDelta < 0 || wallDelta > maxTickGapMs || monoDelta > maxTickGapMs) {
        silentForMs = 0;
        return { stalled: false };
      }
      silentForMs += Math.min(monoDelta, wallDelta);
      if (silentForMs < options.unresponsiveAfterMs) {
        return { stalled: false };
      }
      return {
        stalled: true,
        silentForMs,
        lastHeartbeatAgoMs: Math.max(0, monoNow - lastHeartbeatAt),
      };
    },
  };
}
