/** Content-free, bounded samples. Never store control labels, routes, or message text. */
export type ResponseMetric =
  | "send.handler"
  | "send.frame"
  | "button.handler"
  | "button.frame"
  | "tooltip.handler"
  | "tooltip.frame"
  | "touch.frame"
  | "js.stall"
  | "stream.batch";

export const SLOW_RESPONSE_MS = 100;
const MAX_SAMPLES = 256;

export function createResponsivenessMetrics() {
  const metrics = new Map<
    ResponseMetric,
    { count: number; slow: number; max: number; samples: number[] }
  >();
  return {
    record(metric: ResponseMetric, durationMs: number) {
      if (!Number.isFinite(durationMs) || durationMs < 0) return;
      let entry = metrics.get(metric);
      if (!entry) {
        entry = { count: 0, slow: 0, max: 0, samples: [] };
        metrics.set(metric, entry);
      }
      entry.samples[entry.count % MAX_SAMPLES] = durationMs;
      entry.count++;
      if (durationMs >= SLOW_RESPONSE_MS) entry.slow++;
      entry.max = Math.max(entry.max, durationMs);
    },
    snapshot() {
      return [...metrics].map(([metric, entry]) => {
        const sorted = [...entry.samples].sort((a, b) => a - b);
        const percentile = (p: number) => Math.round(sorted[Math.ceil(sorted.length * p) - 1] ?? 0);
        return {
          metric,
          count: entry.count,
          slow: entry.slow,
          max: Math.round(entry.max),
          p50: percentile(0.5),
          p95: percentile(0.95),
          samples: sorted.length,
        };
      });
    },
  };
}

export const responsivenessMetrics = createResponsivenessMetrics();

export function formatResponsivenessReport(): string {
  const rows = responsivenessMetrics.snapshot();
  return [
    "UI responsiveness (this app session; milliseconds)",
    "  Frame = JS callback to next animation frame, not confirmed screen presentation or host acknowledgement.",
    "  p50/p95 use the latest 256 samples per metric; count/slow/max cover this session; slow >=100ms.",
    ...rows.map(
      (row) =>
        `  ${row.metric}: count=${row.count} slow=${row.slow} p50=${row.p50} p95=${row.p95} max=${row.max}`,
    ),
    ...(rows.length ? [] : ["  No samples yet."]),
  ].join("\n");
}
