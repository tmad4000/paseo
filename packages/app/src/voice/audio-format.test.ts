import { describe, expect, it } from "vitest";
import { describePlaybackError, isPcmMimeType, playbackMimeType } from "./audio-format";

describe("playbackMimeType", () => {
  it("keeps a full MIME type from GPT Realtime instead of prefixing it again", () => {
    expect(playbackMimeType("audio/pcm;rate=24000;bits=16")).toBe("audio/pcm;rate=24000;bits=16");
  });

  it("maps host TTS short names", () => {
    expect(playbackMimeType("pcm")).toBe("audio/pcm;rate=24000;bits=16");
    expect(playbackMimeType("mp3")).toBe("audio/mpeg");
    expect(playbackMimeType("wav")).toBe("audio/wav");
    expect(playbackMimeType("opus")).toBe("audio/opus");
  });
});

describe("isPcmMimeType", () => {
  it("recognizes raw PCM with parameters", () => {
    expect(isPcmMimeType("audio/pcm;rate=24000;bits=16")).toBe(true);
    expect(isPcmMimeType("AUDIO/PCM")).toBe(true);
    expect(isPcmMimeType("audio/L16;rate=16000")).toBe(true);
  });

  it("rejects compressed and malformed types", () => {
    expect(isPcmMimeType("audio/mpeg")).toBe(false);
    expect(isPcmMimeType("audio/wav")).toBe(false);
    expect(isPcmMimeType("audio/audio/pcm;rate=24000")).toBe(false);
  });
});

describe("describePlaybackError", () => {
  it("keeps the DOMException name and message", () => {
    const error = { name: "EncodingError", message: "Unable to decode audio data" };
    expect(describePlaybackError(error)).toBe("EncodingError: Unable to decode audio data");
  });

  it("falls back to whatever is present", () => {
    expect(describePlaybackError(new Error("boom"))).toBe("boom");
    expect(describePlaybackError({ name: "NotAllowedError", message: "" })).toBe("NotAllowedError");
    expect(describePlaybackError("plain")).toBe("plain");
  });
});
