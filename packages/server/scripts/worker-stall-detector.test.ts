import { describe, expect, test } from "vitest";
import {
  createWorkerStallDetector,
  DEFAULT_WORKER_UNRESPONSIVE_RESTART_MS,
  resolveWorkerUnresponsiveRestartMs,
  type WorkerStallDetector,
} from "./worker-stall-detector.js";

const THRESHOLD_MS = 300_000;

function createClockedDetector(unresponsiveAfterMs = THRESHOLD_MS) {
  let mono = 0;
  let wall = 0;
  const detector = createWorkerStallDetector({
    unresponsiveAfterMs,
    monotonicNow: () => mono,
    wallNow: () => wall,
  });
  return {
    detector,
    /** Advance the supervisor clock in regular one-second ticks, as its interval does. */
    tickFor(ms: number) {
      let verdict = detector.tick();
      for (let elapsed = 0; elapsed < ms; elapsed += 1_000) {
        mono += 1_000;
        wall += 1_000;
        verdict = detector.tick();
      }
      return verdict;
    },
    /** The supervisor itself was not scheduled (host sleep or starvation). */
    jump(ms: number) {
      wall += ms;
    },
  };
}

function readyWithHeartbeat(detector: WorkerStallDetector) {
  detector.markReady();
  detector.recordWorkerHeartbeat();
}

describe("worker stall detector", () => {
  test("restarts a ready worker that stays silent while the supervisor keeps running", () => {
    const clock = createClockedDetector();
    readyWithHeartbeat(clock.detector);

    expect(clock.tickFor(THRESHOLD_MS - 1_000).stalled).toBe(false);
    const verdict = clock.tickFor(1_000);

    expect(verdict).toEqual({
      stalled: true,
      silentForMs: THRESHOLD_MS,
      lastHeartbeatAgoMs: THRESHOLD_MS,
    });
  });

  test("a heartbeat restarts the silence window", () => {
    const clock = createClockedDetector();
    readyWithHeartbeat(clock.detector);

    clock.tickFor(THRESHOLD_MS - 1_000);
    clock.detector.recordWorkerHeartbeat();

    expect(clock.tickFor(THRESHOLD_MS - 1_000).stalled).toBe(false);
  });

  test("never judges a worker that has not sent a heartbeat (bootstrap or older worker)", () => {
    const clock = createClockedDetector();
    clock.detector.markReady();

    expect(clock.tickFor(THRESHOLD_MS * 3).stalled).toBe(false);
  });

  test("never judges a worker before it reports readiness", () => {
    const clock = createClockedDetector();
    clock.detector.recordWorkerHeartbeat();

    expect(clock.tickFor(THRESHOLD_MS * 3).stalled).toBe(false);
  });

  test("counts silence no earlier than readiness after a bootstrap heartbeat", () => {
    const clock = createClockedDetector();
    clock.detector.recordWorkerHeartbeat();
    expect(clock.tickFor(THRESHOLD_MS * 3).stalled).toBe(false);

    clock.detector.markReady();
    expect(clock.tickFor(1_000).stalled).toBe(false);
    expect(clock.tickFor(THRESHOLD_MS - 2_000).stalled).toBe(false);
    expect(clock.tickFor(1_000)).toMatchObject({ stalled: true, silentForMs: THRESHOLD_MS });
  });

  test("does not count silence from a period when the supervisor was not scheduled either", () => {
    const clock = createClockedDetector();
    readyWithHeartbeat(clock.detector);

    clock.tickFor(200_000);
    // Host hibernated or was starved: the supervisor's next tick arrives a minute late.
    clock.jump(60_000);
    // 460 s of total silence, but only 200 s of it with a provably running host.
    expect(clock.tickFor(200_000).stalled).toBe(false);

    expect(clock.tickFor(100_000)).toMatchObject({ stalled: true, silentForMs: THRESHOLD_MS });
  });

  test("restarts the silence window when the clock moves backwards", () => {
    const clock = createClockedDetector();
    readyWithHeartbeat(clock.detector);

    clock.tickFor(THRESHOLD_MS - 1_000);
    clock.jump(-1_000);
    expect(clock.tickFor(0).stalled).toBe(false);
    expect(clock.tickFor(THRESHOLD_MS - 1_000).stalled).toBe(false);
    expect(clock.tickFor(1_000)).toMatchObject({ stalled: true, silentForMs: THRESHOLD_MS });
  });

  test("resets after sleep before the first tick", () => {
    const clock = createClockedDetector();
    readyWithHeartbeat(clock.detector);
    clock.jump(THRESHOLD_MS * 2);

    expect(clock.tickFor(0).stalled).toBe(false);
    expect(clock.tickFor(THRESHOLD_MS - 1_000).stalled).toBe(false);
    expect(clock.tickFor(1_000)).toMatchObject({ stalled: true, silentForMs: THRESHOLD_MS });
  });

  test("does not count a forward wall clock step as elapsed silence", () => {
    const clock = createClockedDetector(2_000);
    readyWithHeartbeat(clock.detector);
    clock.jump(3_000);

    expect(clock.tickFor(0).stalled).toBe(false);
    expect(clock.tickFor(1_000).stalled).toBe(false);
    expect(clock.tickFor(1_000)).toMatchObject({ stalled: true, silentForMs: 2_000 });
  });

  test("is disabled by a zero threshold", () => {
    const clock = createClockedDetector(0);
    readyWithHeartbeat(clock.detector);

    expect(clock.tickFor(THRESHOLD_MS * 3).stalled).toBe(false);
  });

  test("resolves the threshold from the environment", () => {
    expect(resolveWorkerUnresponsiveRestartMs({})).toBe(DEFAULT_WORKER_UNRESPONSIVE_RESTART_MS);
    expect(resolveWorkerUnresponsiveRestartMs({ PASEO_WORKER_UNRESPONSIVE_RESTART_MS: "0" })).toBe(
      0,
    );
    expect(
      resolveWorkerUnresponsiveRestartMs({ PASEO_WORKER_UNRESPONSIVE_RESTART_MS: "120000" }),
    ).toBe(120_000);
    expect(
      resolveWorkerUnresponsiveRestartMs({ PASEO_WORKER_UNRESPONSIVE_RESTART_MS: "soon" }),
    ).toBe(DEFAULT_WORKER_UNRESPONSIVE_RESTART_MS);
    expect(resolveWorkerUnresponsiveRestartMs({ PASEO_WORKER_UNRESPONSIVE_RESTART_MS: "-5" })).toBe(
      DEFAULT_WORKER_UNRESPONSIVE_RESTART_MS,
    );
  });
});
