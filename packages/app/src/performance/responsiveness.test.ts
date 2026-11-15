import { describe, expect, it } from "vitest";
import { createResponsivenessMetrics } from "./responsiveness";

describe("responsiveness metrics", () => {
  it("bounds recent samples while retaining session counts, slow counts and worst latency", () => {
    const metrics = createResponsivenessMetrics();
    metrics.record("button.frame", 900);
    for (let i = 0; i < 300; i++) metrics.record("button.frame", 10);
    metrics.record("button.frame", NaN);
    metrics.record("button.frame", -1);
    expect(metrics.snapshot()).toEqual([
      { metric: "button.frame", count: 301, slow: 1, max: 900, p50: 10, p95: 10, samples: 256 },
    ]);
  });
  it("keeps handler, frame and event-loop latency separate", () => {
    const metrics = createResponsivenessMetrics();
    metrics.record("send.handler", 1);
    metrics.record("send.frame", 120);
    metrics.record("js.stall", 250);
    expect(metrics.snapshot().map(({ metric, slow }) => ({ metric, slow }))).toEqual([
      { metric: "send.handler", slow: 0 },
      { metric: "send.frame", slow: 1 },
      { metric: "js.stall", slow: 1 },
    ]);
  });
});
