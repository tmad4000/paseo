import type { AudioPlaybackSource } from "./audio-engine-types";

/** Short local cues distinguish durable admission from provider submission. */
export function createInputReceiptCue(state: "queued" | "sent"): AudioPlaybackSource {
  const sampleRate = 24000;
  const frequencies = state === "queued" ? [523] : [740, 988];
  const noteSamples = Math.round(sampleRate * 0.075);
  const pcm = new Uint8Array(noteSamples * frequencies.length * 2);
  const view = new DataView(pcm.buffer);
  frequencies.forEach((frequency, note) => {
    for (let i = 0; i < noteSamples; i++) {
      const envelope = Math.sin((Math.PI * i) / noteSamples) ** 2;
      const sample = Math.sin((2 * Math.PI * frequency * i) / sampleRate);
      view.setInt16((note * noteSamples + i) * 2, Math.round(sample * envelope * 5500), true);
    }
  });
  return {
    size: pcm.byteLength,
    type: "audio/pcm;rate=24000;bits=16",
    async arrayBuffer() {
      return pcm.buffer;
    },
  };
}
