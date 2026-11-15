// Synthetic speech for isolated daemon RPC tests; no models, devices or provider calls.
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import type { SpeechService, SpeechReadinessState } from "../speech/speech-runtime.js";
import type { StreamingTranscriptionSession } from "../speech/speech-provider.js";
import type { TurnDetectionSession } from "../speech/turn-detection-provider.js";
class Recognizer extends EventEmitter implements StreamingTranscriptionSession {
  requiredSampleRate = 16000;
  async connect() {}
  appendPcm16() {}
  commit() {}
  clear() {}
  close() {}
}
class Detector extends EventEmitter implements TurnDetectionSession {
  requiredSampleRate = 16000;
  async connect() {}
  appendPcm16() {}
  flush() {}
  reset() {}
  close() {}
}
const ready: SpeechReadinessState = {
  enabled: true,
  available: true,
  reasonCode: "ready",
  message: "Synthetic proof speech",
  retryable: false,
  missingModelIds: [],
};
const stt = {
  id: "local",
  createSession: () => {
    const session = new Recognizer();
    return session;
  },
};
export const fakeSpeechService: SpeechService = {
  resolveStt: () => stt,
  resolveDictationStt: () => stt,
  resolveSttLanguage: () => "en",
  resolveDictationSttLanguage: () => "en",
  resolveTts: () => ({
    async synthesizeSpeech() {
      return { stream: Readable.from([Buffer.from("synthetic-audio")]), format: "pcm" };
    },
  }),
  resolveTurnDetection: () => ({
    id: "local",
    createSession: () => {
      const session = new Detector();
      return session;
    },
  }),
  getReadiness: () => ({
    generatedAt: new Date().toISOString(),
    requiredLocalModelIds: [],
    missingLocalModelIds: [],
    download: { inProgress: false, error: null },
    realtimeVoice: ready,
    dictation: ready,
    voiceFeature: ready,
  }),
  onReadinessChange: () => () => {},
  start() {},
  async stop() {},
  ready: Promise.resolve(),
};
