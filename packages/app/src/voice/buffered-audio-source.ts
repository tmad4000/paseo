import { Buffer } from "buffer";
import type { AudioPlaybackSource } from "@/voice/audio-engine-types";
import { playbackMimeType } from "@/voice/audio-format";

export interface BufferedAudioChunk {
  chunkIndex: number;
  audio: string;
  format: string;
  id: string;
}

/** Joins buffered `audio_output` chunks (base64) into one playback source. */
export function buildAudioPlaybackSource(chunks: BufferedAudioChunk[]): AudioPlaybackSource {
  const decodedChunks = chunks.map((chunk) => Buffer.from(chunk.audio, "base64"));
  const totalSize = decodedChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytes = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of decodedChunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }

  return {
    size: bytes.byteLength,
    // Shared mapping: hosts send short names and full MIME types alike.
    type: playbackMimeType(chunks[0]?.format ?? "pcm"),
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}
