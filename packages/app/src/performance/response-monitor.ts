import { recordClientDiagnostic } from "@/diagnostics/client-errors/record";
import { responsivenessMetrics, type ResponseMetric } from "./responsiveness";

const pendingFrames = new Set<number>();
const measuringKinds = new Set<string>();
let active = false;
let activeSince = 0;

export function setResponseMonitoringActive(next: boolean): void {
  if (next && !active) activeSince = performance.now();
  active = next;
  if (!next) {
    for (const id of pendingFrames) cancelAnimationFrame(id);
    pendingFrames.clear();
  }
}

/** Passive observer: no responder ownership and no state updates on the input path. */
export function measureResponseFrame(metric: ResponseMetric, started = performance.now()): void {
  if (!active || pendingFrames.size >= 32 || typeof requestAnimationFrame !== "function") return;
  const id = requestAnimationFrame(() => {
    pendingFrames.delete(id);
    if (active) responsivenessMetrics.record(metric, performance.now() - started);
  });
  pendingFrames.add(id);
}

export function measurePress<T>(kind: "button" | "tooltip" | "send", action: () => T): T {
  if (!active || measuringKinds.has(kind)) return action();
  measuringKinds.add(kind);
  const started = performance.now();
  measureResponseFrame(`${kind}.frame`, started);
  try {
    return action();
  } finally {
    measuringKinds.delete(kind);
    responsivenessMetrics.record(`${kind}.handler`, performance.now() - started);
  }
}

export function installResponseMonitor(appVersion: string | null): () => void {
  let lastTick = performance.now();
  let lastReport = lastTick;
  const reportedSlow = new Map<ResponseMetric, number>();
  const timer = setInterval(() => {
    const now = performance.now();
    if (active) {
      if (lastTick >= activeSince)
        responsivenessMetrics.record("js.stall", Math.max(0, now - lastTick - 1000));
      if (now - lastReport >= 60_000) {
        lastReport = now;
        // Storage and network work happens here, never in a button handler or frame callback.
        for (const row of responsivenessMetrics.snapshot()) {
          if (row.slow <= (reportedSlow.get(row.metric) ?? 0)) continue;
          reportedSlow.set(row.metric, row.slow);
          recordClientDiagnostic({
            source: "global",
            severity: "warning",
            code: "ui_slow_response",
            operation: row.metric,
            phase: `window-${Math.floor(Date.now() / 60_000)}`,
            appVersion,
            message: `UI latency ms: count=${row.count} slow=${row.slow} p50=${row.p50} p95=${row.p95} max=${row.max}; recent samples=${row.samples}`,
          });
        }
      }
    }
    lastTick = now;
  }, 1000);
  return () => {
    clearInterval(timer);
    setResponseMonitoringActive(false);
  };
}
