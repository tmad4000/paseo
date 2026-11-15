import { createPlaybackQueue } from "./playback";
import { parsePcmSampleRate, resampleToPcm16 } from "./pcm";
import { isElectronRuntime } from "@/desktop/host";
import type {
  AudioEngine,
  AudioEngineCallbacks,
  AudioPlaybackSource,
} from "@/audio/audio-engine-types";
import { isPcmMimeType } from "@/voice/audio-format";

const PLAYBACK_RESUME_TIMEOUT_MS = 1_500;

function getAudioContextCtor(): typeof AudioContext | null {
  if (typeof window === "undefined") {
    return null;
  }
  const browserWindow = window as typeof window & {
    webkitAudioContext?: typeof AudioContext;
  };
  return browserWindow.AudioContext ?? browserWindow.webkitAudioContext ?? null;
}

function pcm16LeToAudioBuffer(
  context: AudioContext,
  bytes: Uint8Array,
  sampleRate: number,
): AudioBuffer {
  const sampleCount = Math.floor(bytes.length / 2);
  const audioBuffer = context.createBuffer(1, sampleCount, sampleRate);
  const channel = audioBuffer.getChannelData(0);
  for (let i = 0; i < sampleCount; i += 1) {
    const lo = bytes[i * 2];
    const hi = bytes[i * 2 + 1];
    let value = (hi << 8) | lo;
    if (value & 0x8000) {
      value -= 0x10000;
    }
    channel[i] = value / 0x8000;
  }
  return audioBuffer;
}

async function decodeAudioData(context: AudioContext, buffer: ArrayBuffer): Promise<AudioBuffer> {
  const maybePromise = context.decodeAudioData(buffer.slice(0));
  if (maybePromise && typeof maybePromise.then === "function") {
    return maybePromise;
  }
  return await new Promise<AudioBuffer>((resolve, reject) => {
    context.decodeAudioData(buffer.slice(0), resolve, reject);
  });
}

export function createAudioEngine(
  callbacks: AudioEngineCallbacks,
  _options?: { traceLabel?: string },
): AudioEngine {
  const refs: {
    playbackContext: AudioContext | null;
    captureContext: AudioContext | null;
    stream: MediaStream | null;
    source: MediaStreamAudioSourceNode | null;
    processor: ScriptProcessorNode | null;
    gain: GainNode | null;
    started: boolean;
    muted: boolean;
    /** Removes the armed resume-on-gesture listeners, if any. */
    disarmGestureResume: (() => void) | null;
  } = {
    playbackContext: null,
    captureContext: null,
    stream: null,
    source: null,
    processor: null,
    gain: null,
    started: false,
    muted: false,
    disarmGestureResume: null,
  };

  async function ensurePlaybackContext(): Promise<AudioContext> {
    if (refs.playbackContext) {
      await ensureRunning(refs.playbackContext);
      return refs.playbackContext;
    }

    const AudioContextCtor = getAudioContextCtor();
    if (!AudioContextCtor) {
      throw new Error("AudioContext unavailable");
    }

    const context = new AudioContextCtor();
    refs.playbackContext = context;
    await ensureRunning(context);
    return context;
  }

  // A browser tab without a user gesture keeps the context suspended, and resume() then never
  // settles. Waiting on it hung every reply until the runtime's 90 s timeout. Bound the wait,
  // fail with a named error the runtime can count and show, and resume on the next gesture.
  async function ensureRunning(context: AudioContext): Promise<void> {
    if (context.state !== "suspended") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      context.resume().catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, PLAYBACK_RESUME_TIMEOUT_MS);
      }),
    ]);
    clearTimeout(timer);
    // state changes asynchronously; read it through a function so TypeScript does not narrow it.
    if (readState(context) === "suspended") {
      resumeOnNextGesture(context);
      const error = new Error(
        "Audio output is blocked until you click or press a key in this window",
      );
      error.name = "NotAllowedError";
      throw error;
    }
  }

  function readState(context: AudioContext): AudioContextState {
    return context.state;
  }

  function resumeOnNextGesture(context: AudioContext): void {
    if (refs.disarmGestureResume || typeof window === "undefined") return;
    const disarm = () => {
      window.removeEventListener("pointerdown", resume, true);
      window.removeEventListener("keydown", resume, true);
      if (refs.disarmGestureResume === disarm) refs.disarmGestureResume = null;
    };
    const resume = () => {
      disarm();
      if (context.state === "suspended") void context.resume().catch(() => undefined);
    };
    window.addEventListener("pointerdown", resume, true);
    window.addEventListener("keydown", resume, true);
    refs.disarmGestureResume = disarm;
  }

  async function ensureCaptureContext(): Promise<AudioContext> {
    if (refs.captureContext) {
      if (refs.captureContext.state === "suspended") {
        await refs.captureContext.resume().catch(() => undefined);
      }
      return refs.captureContext;
    }

    const AudioContextCtor = getAudioContextCtor();
    if (!AudioContextCtor) {
      throw new Error("AudioContext unavailable");
    }

    const context = new AudioContextCtor();
    if (context.state === "suspended") {
      await context.resume().catch(() => undefined);
    }
    refs.captureContext = context;
    return context;
  }

  async function playAudio(audio: AudioPlaybackSource, signal: AbortSignal): Promise<number> {
    const context = await ensurePlaybackContext();
    if (signal.aborted) throw new Error("Playback stopped");
    const arrayBuffer = await audio.arrayBuffer();
    if (signal.aborted) throw new Error("Playback stopped");
    const type = (audio.type || "").toLowerCase();
    let audioBuffer: AudioBuffer;
    if (isPcmMimeType(type)) {
      // createBuffer rejects zero frames with NotSupportedError; an empty chunk is just silence.
      if (arrayBuffer.byteLength < 2) return 0;
      audioBuffer = pcm16LeToAudioBuffer(
        context,
        new Uint8Array(arrayBuffer),
        parsePcmSampleRate(type) ?? 24000,
      );
    } else {
      try {
        audioBuffer = await decodeAudioData(context, arrayBuffer);
      } catch (decodeError) {
        // Web Audio cannot decode every container the media element can; try that before failing.
        if (signal.aborted) throw new Error("Playback stopped", { cause: decodeError });
        return await playWithMediaElement(arrayBuffer, type, decodeError, signal);
      }
    }

    if (signal.aborted) throw new Error("Playback stopped");
    const durationSec = audioBuffer.duration;
    const source = context.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(context.destination);

    return await new Promise<number>((resolve, reject) => {
      const abort = () => {
        source.stop();
        source.disconnect();
        reject(new Error("Playback stopped"));
      };
      signal.addEventListener("abort", abort, { once: true });
      source.addEventListener(
        "ended",
        () => {
          signal.removeEventListener("abort", abort);
          source.disconnect();
          resolve(durationSec);
        },
        { once: true },
      );
      try {
        source.start();
      } catch (error) {
        signal.removeEventListener("abort", abort);
        source.disconnect();
        reject(error);
      }
    });
  }

  // Fallback player for compressed clips Web Audio rejected. Rethrows the decode error when the
  // element cannot play it either, so the caller sees the original cause.
  async function playWithMediaElement(
    arrayBuffer: ArrayBuffer,
    type: string,
    decodeError: unknown,
    signal: AbortSignal,
  ): Promise<number> {
    if (signal.aborted) throw new Error("Playback stopped");
    if (typeof Audio === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) {
      throw decodeError;
    }
    const url = URL.createObjectURL(new Blob([arrayBuffer], { type: type || "audio/mpeg" }));
    const element = new Audio(url);
    let abort: (() => void) | undefined;
    try {
      return await new Promise<number>((resolve, reject) => {
        let settled = false;
        const settle = (fn: () => void) => {
          if (settled) return;
          settled = true;
          fn();
        };
        abort = () => {
          element.pause();
          settle(() => reject(new Error("Playback stopped")));
        };
        signal.addEventListener("abort", abort, { once: true });
        element.addEventListener("ended", () => {
          settle(() => resolve(Number.isFinite(element.duration) ? element.duration : 0));
        });
        const fail = () => settle(() => reject(decodeError));
        element.addEventListener("error", fail);
        element.play().catch(fail);
      });
    } finally {
      if (abort) signal.removeEventListener("abort", abort);
      element.pause();
      URL.revokeObjectURL(url);
    }
  }

  const playback = createPlaybackQueue(playAudio);

  async function stopCapture(): Promise<void> {
    refs.started = false;

    try {
      refs.processor?.disconnect();
      refs.source?.disconnect();
      refs.gain?.disconnect();
    } catch {
      // Ignore best-effort teardown errors.
    }

    if (refs.stream) {
      for (const track of refs.stream.getTracks()) {
        try {
          track.stop();
        } catch {
          // Ignore best-effort teardown errors.
        }
      }
    }

    refs.stream = null;
    refs.source = null;
    refs.processor = null;
    refs.gain = null;
    refs.muted = false;
    callbacks.onVolumeLevel(0);

    const captureContext = refs.captureContext;
    refs.captureContext = null;
    if (captureContext && captureContext.state !== "closed") {
      await captureContext.close().catch(() => undefined);
    }
  }

  return {
    async initialize() {
      // Before any gesture the context may be blocked; playback reports that when it matters.
      await ensurePlaybackContext().catch((error: unknown) => {
        if (!(error instanceof Error && error.name === "NotAllowedError")) throw error;
      });
    },

    async destroy() {
      refs.disarmGestureResume?.();
      playback.destroy();
      await stopCapture();

      const playbackContext = refs.playbackContext;
      refs.playbackContext = null;
      if (playbackContext && playbackContext.state !== "closed") {
        await playbackContext.close().catch(() => undefined);
      }
    },

    async startCapture() {
      if (refs.started) {
        return;
      }

      const missingNavigator =
        typeof navigator === "undefined" ||
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getUserMedia !== "function";
      const secureContext =
        typeof window !== "undefined" && typeof window.isSecureContext === "boolean"
          ? window.isSecureContext
          : true;
      const currentOrigin =
        typeof window !== "undefined" && window.location ? window.location.origin : "unknown";
      const isDesktopApp = isElectronRuntime();

      if (missingNavigator) {
        throw new Error("Microphone capture is not supported in this environment");
      }
      if (!secureContext && !isDesktopApp) {
        throw new Error(
          `Microphone access requires HTTPS or localhost. Current origin: ${currentOrigin}`,
        );
      }

      try {
        const context = await ensureCaptureContext();
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            noiseSuppression: true,
            echoCancellation: true,
            autoGainControl: true,
          },
        });
        const source = context.createMediaStreamSource(stream);
        const processor = context.createScriptProcessor(4096, 1, 1);
        const gain = context.createGain();
        gain.gain.value = 0;

        processor.onaudioprocess = (event) => {
          if (!refs.started) {
            return;
          }

          const input = event.inputBuffer.getChannelData(0);
          let sumSquares = 0;
          for (let i = 0; i < input.length; i += 1) {
            const sample = input[i];
            sumSquares += sample * sample;
          }
          const rms = Math.sqrt(sumSquares / Math.max(1, input.length));
          const normalized = Math.min(1, Math.max(0, rms * 2));
          callbacks.onVolumeLevel(normalized);

          if (refs.muted) {
            return;
          }

          const pcm = resampleToPcm16(input, context.sampleRate, 16000);
          callbacks.onCaptureData(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
        };

        source.connect(processor);
        processor.connect(gain);
        gain.connect(context.destination);

        // A track ends by itself when the device is unplugged or access is revoked.
        for (const track of stream.getAudioTracks()) {
          track.addEventListener("ended", () => {
            if (refs.stream === stream) callbacks.onInterruption?.();
          });
        }

        refs.started = true;
        refs.stream = stream;
        refs.source = source;
        refs.processor = processor;
        refs.gain = gain;
      } catch (error) {
        await stopCapture();
        const wrapped = error instanceof Error ? error : new Error(String(error));
        callbacks.onError?.(wrapped);
        throw wrapped;
      }
    },

    async stopCapture() {
      await stopCapture();
    },

    toggleMute() {
      refs.muted = !refs.muted;
      if (refs.muted) {
        callbacks.onVolumeLevel(0);
      }
      return refs.muted;
    },

    isMuted() {
      return refs.muted;
    },

    play: playback.play,
    stop: playback.stop,
    clearQueue: playback.clearQueue,
    isPlaying: playback.isPlaying,
  };
}
