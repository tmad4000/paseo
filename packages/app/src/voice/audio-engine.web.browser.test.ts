import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { createAudioEngine } from "./audio-engine.web";
import type { AudioEngine, AudioPlaybackSource } from "./audio-engine-types";
import { playbackMimeType } from "./audio-format";

// Real Chromium Web Audio: the GPT Realtime silence came from decodeAudioData rejecting raw PCM
// with EncodingError, which only a real AudioContext reproduces.

function source(bytes: Uint8Array, type: string): AudioPlaybackSource {
  return {
    size: bytes.byteLength,
    type,
    async arrayBuffer() {
      return Uint8Array.from(bytes).buffer;
    },
  };
}

function pcm16(samples: number): Uint8Array {
  const pcm = new Int16Array(samples);
  for (let i = 0; i < samples; i += 1) pcm[i] = Math.round(Math.sin(i / 8) * 4000);
  return new Uint8Array(pcm.buffer);
}

let engine: AudioEngine | null = null;

function createEngine(): AudioEngine {
  engine = createAudioEngine({ onCaptureData: () => {}, onVolumeLevel: () => {} });
  return engine;
}

afterEach(async () => {
  await engine?.destroy();
  engine = null;
  vi.restoreAllMocks();
});

describe("web audio engine playback", () => {
  it("fails fast with NotAllowedError while the tab has no user gesture, instead of hanging", async () => {
    const player = createEngine();
    const started = performance.now();
    const error = await player
      .play(source(pcm16(1200), "audio/pcm;rate=24000;bits=16"))
      .then(() => null)
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ name: "NotAllowedError" });
    expect(performance.now() - started).toBeLessThan(5_000);
  });

  it("plays a GPT Realtime PCM chunk instead of decoding it", async () => {
    await userEvent.click(document.body);
    const player = createEngine();
    const decode = vi.spyOn(AudioContext.prototype, "decodeAudioData");
    // 1200 samples at 24 kHz = 50 ms.
    const type = playbackMimeType("audio/pcm;rate=24000;bits=16");
    const duration = await player.play(source(pcm16(1200), type));
    expect(duration).toBeCloseTo(0.05, 3);
    expect(decode).not.toHaveBeenCalled();
  });

  it("treats an empty PCM chunk as silence instead of throwing NotSupportedError", async () => {
    const player = createEngine();
    await expect(
      player.play(source(new Uint8Array(0), "audio/pcm;rate=24000;bits=16")),
    ).resolves.toBe(0);
  });

  it("rejects undecodable audio with a named error after the media element fallback fails", async () => {
    const player = createEngine();
    const error = await player
      .play(source(pcm16(1200), "audio/mpeg"))
      .then(() => null)
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ name: "EncodingError" });
  });
});
