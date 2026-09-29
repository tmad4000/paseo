import { describe, expect, it } from "vitest";
import {
  NOTHING_RECOGNIZED_MIN_SPEECH_MS,
  resolveVoiceRecognitionIssue,
} from "./voice-recognition-issue.js";

describe("resolveVoiceRecognitionIssue", () => {
  const long = NOTHING_RECOGNIZED_MIN_SPEECH_MS;

  it("reports a long utterance that produced no text", () => {
    expect(
      resolveVoiceRecognitionIssue({
        transcript: "",
        speechMs: long,
        timedOut: false,
        inputMuted: false,
      }),
    ).toBe("nothing_recognized");
  });

  it("stays quiet for short noise and for recognized speech", () => {
    expect(
      resolveVoiceRecognitionIssue({
        transcript: "",
        speechMs: long - 1,
        timedOut: false,
        inputMuted: false,
      }),
    ).toBeNull();
    expect(
      resolveVoiceRecognitionIssue({
        transcript: "hello",
        speechMs: long,
        timedOut: true,
        inputMuted: false,
      }),
    ).toBeNull();
  });

  it("does not report discarded speech while muted", () => {
    expect(
      resolveVoiceRecognitionIssue({
        transcript: "",
        speechMs: long,
        timedOut: false,
        inputMuted: true,
      }),
    ).toBeNull();
  });

  it("reports a recognizer that never answered, muted or not", () => {
    for (const inputMuted of [false, true]) {
      expect(
        resolveVoiceRecognitionIssue({ transcript: "", speechMs: 0, timedOut: true, inputMuted }),
      ).toBe("timed_out");
    }
  });
});
