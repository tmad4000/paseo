import { afterEach, describe, expect, it, vi } from "vitest";
import { setClientDiagnosticSink } from "@/diagnostics/client-errors/record";
import {
  installResponseMonitor,
  measurePress,
  measureResponseFrame,
  setResponseMonitoringActive,
} from "./response-monitor";
import { responsivenessMetrics } from "./responsiveness";

afterEach(() => {
  setResponseMonitoringActive(false);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("response monitor", () => {
  it("runs actions immediately, preserves thrown errors and bounds pending frames", () => {
    let id = 0;
    const frame = vi.fn(() => ++id);
    vi.stubGlobal("requestAnimationFrame", frame);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    setResponseMonitoringActive(true);
    expect(measurePress("send", () => 42)).toBe(42);
    const fail = () => {
      throw new Error("original");
    };
    expect(() => measurePress("send", fail)).toThrow("original");
    for (let n = 0; n < 100; n++) measureResponseFrame("touch.frame");
    expect(frame).toHaveBeenCalledTimes(32);
  });

  it("does not count suspension as a stall and reports slow samples off the input path", () => {
    vi.useFakeTimers();
    const events: unknown[] = [];
    const uninstall = setClientDiagnosticSink((event) => {
      events.push(event);
    });
    const stop = installResponseMonitor("test-version");
    try {
      setResponseMonitoringActive(false);
      vi.advanceTimersByTime(120_000);
      setResponseMonitoringActive(true);
      vi.advanceTimersByTime(1000);
      expect(events).toEqual([]);
      responsivenessMetrics.record("touch.frame", 150);
      expect(events).toEqual([]);
      vi.advanceTimersByTime(60_000);
      expect(events).toEqual([
        expect.objectContaining({
          code: "ui_slow_response",
          operation: "touch.frame",
          appVersion: "test-version",
        }),
      ]);
      const stalled = responsivenessMetrics.snapshot().find((row) => row.metric === "js.stall");
      expect(stalled?.slow).toBe(0);
      expect(stalled?.max).toBe(0);
    } finally {
      stop();
      uninstall();
    }
  });
});
