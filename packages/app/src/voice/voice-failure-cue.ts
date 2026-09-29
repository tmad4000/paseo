import { Buffer } from "buffer";
import type { AudioPlaybackSource } from "./audio-engine-types";
import type { VoiceFailureKind } from "./voice-failure";
import {
  VOICE_FAILURE_PHRASE_MULAW_BASE64,
  VOICE_FAILURE_PHRASE_SAMPLE_RATE,
} from "./voice-failure-phrases.mulaw";

const SAMPLE_RATE = VOICE_FAILURE_PHRASE_SAMPLE_RATE;
const BUZZ_MS = 360;
const BUZZ_START_HZ = 311;
const BUZZ_END_HZ = 208;
const BUZZ_HARMONICS = 6;
const GAP_MS = 120;

function samplesFor(ms: number): number {
  return Math.round((SAMPLE_RATE * ms) / 1000);
}

/**
 * The failure earcon: one buzzy tone gliding down over a third of a second. Every other
 * voice earcon (mute, unmute, speech rate) is a short run of pure sine notes, so the
 * harmonic timbre, the continuous glide, and the length each set this one apart.
 */
function writeBuzz(view: DataView, offsetSamples: number): void {
  const total = samplesFor(BUZZ_MS);
  const attack = samplesFor(10);
  const release = samplesFor(80);
  let normalization = 0;
  for (let h = 1; h <= BUZZ_HARMONICS; h++) normalization += 1 / h;
  let phase = 0;
  for (let i = 0; i < total; i++) {
    const progress = i / total;
    const frequency = BUZZ_START_HZ * (BUZZ_END_HZ / BUZZ_START_HZ) ** progress;
    phase += (2 * Math.PI * frequency) / SAMPLE_RATE;
    let sample = 0;
    for (let h = 1; h <= BUZZ_HARMONICS; h++) sample += Math.sin(phase * h) / h;
    const envelope = Math.min(1, i / attack, (total - i) / release);
    view.setInt16(
      (offsetSamples + i) * 2,
      Math.round((sample / normalization) * envelope * 9000),
      true,
    );
  }
}

// G.711 mu-law expansion; the phrases ship compressed to half the size of PCM16.
function decodeMuLaw(byte: number): number {
  const value = ~byte & 0xff;
  const sign = value & 0x80;
  const exponent = (value >> 4) & 0x07;
  const mantissa = value & 0x0f;
  const magnitude = (((mantissa << 3) + 0x84) << exponent) - 0x84;
  return sign ? -magnitude : magnitude;
}

type PhraseKey = keyof typeof VOICE_FAILURE_PHRASE_MULAW_BASE64;

function toSource(pcm: Uint8Array): AudioPlaybackSource {
  return {
    size: pcm.byteLength,
    type: `audio/pcm;rate=${SAMPLE_RATE};bits=16`,
    async arrayBuffer() {
      return pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer;
    },
  };
}

function buildCue(phrase: PhraseKey, withBuzz: boolean): AudioPlaybackSource {
  const encoded = Buffer.from(VOICE_FAILURE_PHRASE_MULAW_BASE64[phrase], "base64");
  const prefixSamples = withBuzz ? samplesFor(BUZZ_MS) + samplesFor(GAP_MS) : 0;
  const pcm = new Uint8Array((prefixSamples + encoded.length) * 2);
  const view = new DataView(pcm.buffer);
  if (withBuzz) writeBuzz(view, 0);
  for (let i = 0; i < encoded.length; i++) {
    view.setInt16((prefixSamples + i) * 2, decodeMuLaw(encoded[i]), true);
  }
  return toSource(pcm);
}

/** The failure earcon followed by a spoken name for the failure. Played on the device. */
export function createVoiceFailureCue(kind: VoiceFailureKind): AudioPlaybackSource {
  return buildCue(kind, true);
}

/** Spoken once the host is back after a disconnect that was announced. */
export function createVoiceReconnectedCue(): AudioPlaybackSource {
  return buildCue("reconnected", false);
}
