/**
 * Maps an `audio_output.format` value from the host to the MIME type the audio engines read.
 *
 * Hosts send two shapes: bare names from host TTS (`pcm`, `mp3`, `wav`) and full MIME types
 * from GPT Realtime (`audio/pcm;rate=24000;bits=16`). Prefixing a full MIME type a second time
 * (`audio/audio/pcm…`) made the web engine treat raw PCM as a compressed file and reject every
 * chunk with `EncodingError`, so GPT voice was silent on desktop and web.
 */
export function playbackMimeType(format: string): string {
  const normalized = format.trim();
  const lower = normalized.toLowerCase();
  if (lower === "" || lower === "pcm") return "audio/pcm;rate=24000;bits=16";
  if (lower === "mp3") return "audio/mpeg";
  if (lower.includes("/")) return normalized;
  return `audio/${normalized}`;
}

/** Raw 16-bit little-endian PCM, which must be wrapped in a buffer rather than decoded. */
export function isPcmMimeType(mimeType: string): boolean {
  const essence = mimeType.trim().toLowerCase().split(";")[0]?.trim() ?? "";
  return essence === "audio/pcm" || essence === "audio/l16" || essence === "pcm";
}

/**
 * A readable description of a playback failure. Electron's logger prints a DOMException as
 * `[object DOMException]`, losing the name that says what went wrong.
 */
export function describePlaybackError(error: unknown): string {
  if (error && typeof error === "object") {
    const name = "name" in error && typeof error.name === "string" ? error.name : "";
    const message = "message" in error && typeof error.message === "string" ? error.message : "";
    // A plain Error's name adds nothing; a DOMException's name is the diagnosis.
    if (name && name !== "Error" && message) return `${name}: ${message}`;
    if (message) return message;
    if (name) return name;
  }
  return String(error);
}
