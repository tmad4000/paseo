import { describe, expect, it } from "vitest";
import {
  createVoiceFailureTracker,
  voiceFailureFromRecognitionIssue,
  type VoiceFailureKind,
} from "@/voice/voice-failure";
import { createVoiceFailureCue, createVoiceReconnectedCue } from "@/voice/voice-failure-cue";

function createClock() {
  let now = 0;
  return {
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
  };
}

describe("voice failure tracker", () => {
  it("speaks a repeating failure once per episode", () => {
    const clock = createClock();
    const tracker = createVoiceFailureTracker(clock.now);
    expect(tracker.report("recognition-failed")).toBe(true);
    for (let i = 0; i < 50; i++) {
      clock.advance(200);
      expect(tracker.report("recognition-failed")).toBe(false);
    }
    expect(tracker.current()).toBe("recognition-failed");
  });

  it("bounds a flapping connection to one disconnect and one recovery per window", () => {
    const clock = createClock();
    const tracker = createVoiceFailureTracker(clock.now);
    const spoken: string[] = [];
    for (let i = 0; i < 20; i++) {
      if (tracker.report("host-disconnected")) spoken.push("disconnected");
      clock.advance(300);
      if (tracker.clear(["host-disconnected"]).length > 0) spoken.push("reconnected");
      clock.advance(300);
    }
    expect(spoken).toEqual(["disconnected", "reconnected"]);

    clock.advance(30_000);
    expect(tracker.report("host-disconnected")).toBe(true);
  });

  it("names a new kind of failure, unless it follows another within the cascade window", () => {
    const clock = createClock();
    const tracker = createVoiceFailureTracker(clock.now);
    expect(tracker.report("host-disconnected")).toBe(true);
    clock.advance(1_000);
    expect(tracker.report("recognition-failed")).toBe(false);
    expect(tracker.current()).toBe("recognition-failed");
    clock.advance(5_000);
    expect(tracker.report("microphone-lost")).toBe(true);
  });

  it("repeats a miss only after recognition worked in between", () => {
    const clock = createClock();
    const tracker = createVoiceFailureTracker(clock.now);
    expect(tracker.report("nothing-recognized")).toBe(true);
    clock.advance(15_000);
    expect(tracker.report("nothing-recognized")).toBe(false);
    expect(tracker.clear(["nothing-recognized"])).toEqual(["nothing-recognized"]);
    expect(tracker.current()).toBeNull();
    clock.advance(1_000);
    expect(tracker.report("nothing-recognized")).toBe(true);
  });

  it("maps host recognition issues and ignores values it does not know", () => {
    expect(voiceFailureFromRecognitionIssue("nothing_recognized")).toBe("nothing-recognized");
    expect(voiceFailureFromRecognitionIssue("timed_out")).toBe("recognition-stalled");
    expect(voiceFailureFromRecognitionIssue("failed")).toBe("recognition-failed");
    expect(voiceFailureFromRecognitionIssue("something_new")).toBeNull();
  });

  it("builds a separate spoken cue for every failure, each led by the failure earcon", async () => {
    const kinds: VoiceFailureKind[] = [
      "nothing-recognized",
      "recognition-stalled",
      "recognition-failed",
      "recognition-unavailable",
      "host-disconnected",
      "microphone-lost",
    ];
    const sizes = new Set(kinds.map((kind) => createVoiceFailureCue(kind).size));
    sizes.add(createVoiceReconnectedCue().size);
    expect(sizes.size).toBe(kinds.length + 1);

    const cue = createVoiceFailureCue("recognition-failed");
    expect(cue.type).toBe("audio/pcm;rate=12000;bits=16");
    const samples = new Int16Array(await cue.arrayBuffer());
    // 360 ms of earcon at 12 kHz, then a 120 ms gap before the phrase.
    const earcon = samples.subarray(0, 4320);
    expect(Math.max(...earcon.map(Math.abs))).toBeGreaterThan(5000);
    expect(Math.max(...samples.subarray(4320, 5760).map(Math.abs))).toBe(0);
  });
});
