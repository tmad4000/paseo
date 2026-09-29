import { Readable } from "node:stream";
import type { VoiceSpeakHandler } from "../../voice-types.js";
import { EventEmitter } from "node:events";
import pino from "pino";
import { describe, expect, test, vi } from "vitest";

import { VoiceSession, type VoiceSessionHost } from "./voice-session.js";
import type { ManagedAgent } from "../../agent/agent-manager.js";
import type { AgentStreamEvent } from "../../agent/agent-sdk-types.js";
import type { SessionOutboundMessage } from "../../messages.js";
import type {
  SpeechToTextProvider,
  TextToSpeechProvider,
  StreamingTranscriptionCommittedEvent,
  StreamingTranscriptionEvent,
  StreamingTranscriptionSession,
} from "../../speech/speech-provider.js";
import type {
  TurnDetectionProvider,
  TurnDetectionSession,
} from "../../speech/turn-detection-provider.js";

const VOICE_AGENT_ID = "11111111-1111-4111-8111-111111111111";

class FakeVoiceTurnDetectionSession extends EventEmitter implements TurnDetectionSession {
  public readonly requiredSampleRate = 16000;

  async connect(): Promise<void> {}

  appendPcm16(_chunk: Buffer): void {}

  flush(): void {}
  reset(): void {}
  close(): void {}
}

class FakeVoiceSttSession extends EventEmitter implements StreamingTranscriptionSession {
  public readonly requiredSampleRate = 16000;
  public commitCount = 0;

  async connect(): Promise<void> {}

  appendPcm16(_pcm16le: Buffer): void {}

  commit(): void {
    this.commitCount += 1;
  }

  clear(): void {}
  close(): void {}

  emitCommitted(event: StreamingTranscriptionCommittedEvent): void {
    this.emit("committed", event);
  }

  emitTranscript(event: StreamingTranscriptionEvent): void {
    this.emit("transcript", event);
  }
}

interface FakeVoiceHost extends VoiceSessionHost {
  readonly emitted: SessionOutboundMessage[];
  readonly spokenInput: Array<{ agentId: string; text: string; messageId: string }>;
  readonly worker: { turnId: string; childHeartbeat: number; running: boolean };
}

function createFakeHost(): FakeVoiceHost {
  const emitted: SessionOutboundMessage[] = [];
  const spokenInput: Array<{ agentId: string; text: string; messageId: string }> = [];
  const worker = { turnId: "active-turn", childHeartbeat: 1, running: true };
  return {
    emitted,
    spokenInput,
    worker,
    emit: (msg) => {
      emitted.push(msg);
    },
    loadAgent: async (agentId) =>
      ({ id: agentId, config: { systemPrompt: undefined } }) as unknown as ManagedAgent,
    sendSpokenInput: async (agentId, text, messageId) => {
      spokenInput.push({ agentId, text, messageId });
    },
  };
}

function createVoiceSession(tts: TextToSpeechProvider | null = null, sttProviderId = "local") {
  let speakHandler: VoiceSpeakHandler | undefined;
  const detector = new FakeVoiceTurnDetectionSession();
  const sttSession = new FakeVoiceSttSession();
  const stt: SpeechToTextProvider = {
    id: sttProviderId,
    createSession: vi.fn(() => sttSession),
  };
  const turnDetection: TurnDetectionProvider = {
    id: "local",
    createSession: vi.fn(() => detector),
  };
  const host = createFakeHost();
  const voiceSession = new VoiceSession({
    host,
    logger: pino({ level: "silent" }),
    sessionId: "voice-session-test",
    sttLanguage: "en",
    tts,
    voiceBridge: {
      registerVoiceSpeakHandler: (_id, _attachmentId, handler) => {
        speakHandler = handler;
        return "test-generation";
      },
    },
    stt,
    voice: { turnDetection },
  });
  return {
    voiceSession,
    detector,
    sttSession,
    host,
    speak: (args: Parameters<VoiceSpeakHandler>[0]) => {
      if (!speakHandler) throw new Error("Voice speak handler not registered");
      return speakHandler(args);
    },
  };
}

function isAudioOutput(message: SessionOutboundMessage): boolean {
  return message.type === "audio_output";
}

async function waitForAudioOutput(host: FakeVoiceHost): Promise<void> {
  await vi.waitFor(() => expect(host.emitted.filter(isAudioOutput)).toHaveLength(1));
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("VoiceSession streaming transcription", () => {
  test("reads new visible assistant text at turn end for a live session without speak", async () => {
    const tts: TextToSpeechProvider = {
      async synthesizeSpeech() {
        return { stream: Readable.from([Buffer.from("audio")]), format: "pcm;rate=24000" };
      },
    };
    const { voiceSession, host } = createVoiceSession(tts);
    await voiceSession.handleSetVoiceMode(true, VOICE_AGENT_ID);
    voiceSession.handleAgentEvent({ type: "turn_started" } as AgentStreamEvent);
    voiceSession.handleAgentEvent({
      type: "timeline",
      item: { type: "assistant_message", text: "Visible answer." },
    } as AgentStreamEvent);
    voiceSession.handleAgentEvent({ type: "turn_completed" } as AgentStreamEvent);
    try {
      await waitForAudioOutput(host);
      const audio = host.emitted.find((message) => message.type === "audio_output");
      if (audio?.type !== "audio_output") throw new Error("Missing fallback playback");
      voiceSession.handleAudioPlayed(audio.payload.id);
      await settle();
      expect(host.emitted.filter(isAudioOutput)).toHaveLength(1);
    } finally {
      await voiceSession.cleanup();
    }
  });

  test("barge-in stops playback while the active turn and child keep working", async () => {
    const tts: TextToSpeechProvider = {
      async synthesizeSpeech() {
        return { stream: Readable.from([Buffer.from("audio")]), format: "pcm;rate=24000" };
      },
    };
    const { voiceSession, detector, host, speak } = createVoiceSession(tts);
    const worker = host.worker;
    await voiceSession.handleSetVoiceMode(true, VOICE_AGENT_ID);
    const playback = speak({ text: "A spoken response." });
    try {
      await waitForAudioOutput(host);
      detector.emit("speech_started");
      await settle();
      expect(host.emitted).toContainEqual(
        expect.objectContaining({
          type: "voice_input_state",
          payload: expect.objectContaining({ isSpeaking: true }),
        }),
      );
      expect(host.worker).toBe(worker);
      expect(host.worker).toEqual({ turnId: "active-turn", childHeartbeat: 1, running: true });
      await playback;
      const nextPlayback = speak({ text: "The next response still plays." });
      await vi.waitFor(() => expect(host.emitted.filter(isAudioOutput)).toHaveLength(2));
      const latest = host.emitted.findLast((message) => message.type === "audio_output");
      if (latest?.type !== "audio_output") throw new Error("Missing next audio output");
      voiceSession.handleAudioPlayed(latest.payload.id);
      await nextPlayback;
    } finally {
      await voiceSession.cleanup();
      await playback.catch(() => {});
    }
  });

  test("session abort stops later audio even when the speak tool supplies its own signal", async () => {
    const tts: TextToSpeechProvider = {
      async synthesizeSpeech() {
        return { stream: Readable.from([Buffer.from("audio")]), format: "pcm;rate=24000" };
      },
    };
    const { voiceSession, host, speak } = createVoiceSession(tts);
    const external = new AbortController();
    let abortRequested = false;
    const emit = host.emit;
    function acknowledgeLaterAudio(message: SessionOutboundMessage) {
      emit(message);
      if (message.type === "audio_output" && abortRequested)
        voiceSession.handleAudioPlayed(message.payload.id);
    }
    host.emit = acknowledgeLaterAudio;
    await voiceSession.handleSetVoiceMode(true, VOICE_AGENT_ID);
    const playback = speak({
      text: "First sentence. Second sentence. Third sentence.",
      signal: external.signal,
    });
    try {
      await waitForAudioOutput(host);
      abortRequested = true;
      await voiceSession.handleAbort();
      await playback;
      expect(host.emitted.filter(isAudioOutput)).toHaveLength(1);
      expect(external.signal.aborted).toBe(false);
    } finally {
      external.abort();
      await voiceSession.cleanup();
      await playback.catch(() => {});
    }
  });

  test.each(["openai", "custom-cloud"])(
    "never enables verbal mute with %s STT",
    async (provider) => {
      const { voiceSession, host } = createVoiceSession(null, provider);
      await voiceSession.handleSetVoiceMode(true, VOICE_AGENT_ID, "start", {
        voiceCommandsEnabled: true,
      });
      expect(host.emitted).toContainEqual(
        expect.objectContaining({
          type: "set_voice_mode_response",
          payload: expect.objectContaining({
            accepted: true,
            voiceCommandsEnabled: false,
            isMuted: false,
          }),
        }),
      );
      await voiceSession.handleSetInputMuted({ muted: true, requestId: "mute" });
      expect(host.emitted).toContainEqual({
        type: "voice.input.set_muted.response",
        payload: {
          requestId: "mute",
          muted: false,
          error: "Verbal mute requires an active voice session with local speech recognition.",
        },
      });
      await voiceSession.cleanup();
    },
  );

  test("requires client opt-in and retains muted state on reconnect", async () => {
    const { voiceSession, host } = createVoiceSession();
    await voiceSession.handleSetVoiceMode(true, VOICE_AGENT_ID, "old-client");
    expect(host.emitted).toContainEqual(
      expect.objectContaining({
        type: "set_voice_mode_response",
        payload: expect.objectContaining({ voiceCommandsEnabled: false }),
      }),
    );
    await voiceSession.handleSetVoiceMode(true, VOICE_AGENT_ID, "start", {
      voiceCommandsEnabled: true,
    });
    await voiceSession.handleSetInputMuted({ muted: true, requestId: "mute" });
    expect(host.emitted).toContainEqual({
      type: "voice.input.set_muted.response",
      payload: { requestId: "mute", muted: true, error: null },
    });
    await voiceSession.handleSetVoiceMode(true, VOICE_AGENT_ID, "reconnect", {
      voiceCommandsEnabled: true,
      isMuted: true,
    });
    expect(host.emitted).toContainEqual(
      expect.objectContaining({
        type: "set_voice_mode_response",
        payload: expect.objectContaining({
          requestId: "reconnect",
          voiceCommandsEnabled: true,
          isMuted: true,
        }),
      }),
    );
    expect(host.spokenInput).toEqual([]);
    await voiceSession.cleanup();
  });

  test("verbal mute discards private speech and hears unmute without sending either command", async () => {
    const { voiceSession, detector, sttSession, host } = createVoiceSession();
    await voiceSession.handleSetVoiceMode(true, VOICE_AGENT_ID, "start", {
      voiceCommandsEnabled: true,
    });
    let segment = 0;
    async function say(transcript: string) {
      const segmentId = `command-${++segment}`;
      detector.emit("speech_started");
      await settle();
      sttSession.emitTranscript({ segmentId, transcript, isFinal: false });
      await settle();
      detector.emit("speech_stopped");
      await settle();
      sttSession.emitCommitted({ segmentId, previousSegmentId: null });
      sttSession.emitTranscript({ segmentId, transcript, isFinal: true });
      await settle();
      await settle();
    }

    await say("Mute microphone.");
    expect(host.emitted).toContainEqual(
      expect.objectContaining({
        type: "voice_input_state",
        payload: expect.objectContaining({ isSpeaking: false, isMuted: true }),
      }),
    );
    host.emitted.length = 0;
    await say("private conversation");
    await say("please explain how to unmute microphone");
    expect(host.emitted).toEqual([]);
    expect(host.spokenInput).toEqual([]);

    await say("Unmute microphone!");
    expect(host.emitted).toContainEqual(
      expect.objectContaining({
        type: "voice_input_state",
        payload: expect.objectContaining({ isSpeaking: false, isMuted: false }),
      }),
    );
    expect(host.spokenInput).toEqual([]);
    await say("continue working");
    expect(host.spokenInput).toEqual([
      expect.objectContaining({
        agentId: VOICE_AGENT_ID,
        text: "continue working",
        messageId: expect.stringContaining(":command-5"),
      }),
    ]);
    await voiceSession.cleanup();
  });

  test("abort leaves the worker and its child alive", async () => {
    const { voiceSession, host } = createVoiceSession();
    const worker = host.worker;
    await voiceSession.handleSetVoiceMode(true, VOICE_AGENT_ID);
    await voiceSession.handleAbort();
    expect(host.worker).toBe(worker);
    expect(host.worker.running).toBe(true);
    expect(host.worker.childHeartbeat).toBe(1);

    await voiceSession.cleanup();
  });

  test("stopping and restarting voice preserves the provider turn and child", async () => {
    const { voiceSession, host } = createVoiceSession();
    const worker = host.worker;
    await voiceSession.handleSetVoiceMode(true, VOICE_AGENT_ID, "start");
    await voiceSession.handleSetVoiceMode(false, VOICE_AGENT_ID, "stop");
    expect(host.worker).toBe(worker);
    expect(host.worker.running).toBe(true);
    await voiceSession.handleSetVoiceMode(true, VOICE_AGENT_ID, "restart");
    expect(host.worker.turnId).toBe("active-turn");
    expect(host.worker.childHeartbeat).toBe(1);
    await voiceSession.cleanup();
  });

  test("delivers the streaming final transcript to the agent exactly once", async () => {
    const { voiceSession, detector, sttSession, host } = createVoiceSession();

    await voiceSession.handleSetVoiceMode(true, VOICE_AGENT_ID);
    detector.emit("speech_started");
    await settle();
    detector.emit("speech_stopped");
    await settle();
    sttSession.emitCommitted({ segmentId: "segment-1", previousSegmentId: null });
    sttSession.emitTranscript({
      segmentId: "segment-1",
      transcript: "ship the streaming final",
      isFinal: true,
      language: "en",
      avgLogprob: -0.1,
      isLowConfidence: false,
    });
    await settle();

    expect(sttSession.commitCount).toBe(1);
    expect(host.spokenInput).toEqual([
      expect.objectContaining({
        agentId: VOICE_AGENT_ID,
        text: "ship the streaming final",
        messageId: expect.stringContaining(":segment-1"),
      }),
    ]);
    expect(host.emitted).toContainEqual(
      expect.objectContaining({
        type: "transcription_result",
        payload: expect.objectContaining({
          text: "ship the streaming final",
          language: "en",
          avgLogprob: -0.1,
        }),
      }),
    );

    await voiceSession.cleanup();
  });

  test("emits an empty transcript on finalization timeout without submitting to the agent", async () => {
    vi.useFakeTimers();
    try {
      const { voiceSession, detector, sttSession, host } = createVoiceSession();

      await voiceSession.handleSetVoiceMode(true, VOICE_AGENT_ID);
      detector.emit("speech_started");
      await settle();
      detector.emit("speech_stopped");
      await settle();
      sttSession.emitCommitted({ segmentId: "segment-1", previousSegmentId: null });

      await vi.advanceTimersByTimeAsync(10_000);
      await settle();

      expect(host.spokenInput).toEqual([]);
      const transcriptIndex = host.emitted.findIndex(
        (message) => message.type === "transcription_result" && message.payload.text === "",
      );
      const issueIndex = host.emitted.findIndex(
        (message) =>
          message.type === "voice_input_state" && message.payload.recognitionIssue === "timed_out",
      );
      expect(transcriptIndex).toBeGreaterThanOrEqual(0);
      // The issue follows the empty transcript, which is what returns the app to listening.
      expect(issueIndex).toBeGreaterThan(transcriptIndex);

      await voiceSession.cleanup();
    } finally {
      vi.useRealTimers();
    }
  });

  test("reports a long utterance that recognized nothing, but not a short noise", async () => {
    vi.useFakeTimers();
    try {
      const { voiceSession, detector, sttSession, host } = createVoiceSession();
      await voiceSession.handleSetVoiceMode(true, VOICE_AGENT_ID, "start", {
        voiceCommandsEnabled: true,
      });
      async function utterance(segmentId: string, speechMs: number) {
        detector.emit("speech_started");
        await settle();
        await vi.advanceTimersByTimeAsync(speechMs);
        detector.emit("speech_stopped");
        await settle();
        sttSession.emitCommitted({ segmentId, previousSegmentId: null });
        sttSession.emitTranscript({
          segmentId,
          transcript: "",
          isFinal: true,
          isLowConfidence: true,
        });
        await settle();
        await settle();
      }
      function issues() {
        return host.emitted.flatMap((message) =>
          message.type === "voice_input_state" && message.payload.recognitionIssue
            ? [message.payload.recognitionIssue]
            : [],
        );
      }

      await utterance("cough", 1_100);
      expect(issues()).toEqual([]);
      await utterance("mumble", 2_500);
      expect(issues()).toEqual(["nothing_recognized"]);
      expect(host.spokenInput).toEqual([]);

      await voiceSession.cleanup();
    } finally {
      vi.useRealTimers();
    }
  });

  test("reports a recognizer error without pausing clients that lack verbal commands", async () => {
    const { voiceSession, sttSession, host } = createVoiceSession();
    await voiceSession.handleSetVoiceMode(true, VOICE_AGENT_ID);

    sttSession.emit("error", new Error("speech worker exited"));
    await settle();

    expect(host.emitted).toContainEqual(
      expect.objectContaining({
        type: "voice_input_state",
        payload: expect.objectContaining({ isSpeaking: false, recognitionIssue: "failed" }),
      }),
    );
    await voiceSession.cleanup();
  });

  test("filters a low-confidence streaming final without submitting to the agent", async () => {
    const { voiceSession, detector, sttSession, host } = createVoiceSession();

    await voiceSession.handleSetVoiceMode(true, VOICE_AGENT_ID);
    detector.emit("speech_started");
    await settle();
    detector.emit("speech_stopped");
    await settle();
    sttSession.emitCommitted({ segmentId: "segment-1", previousSegmentId: null });
    sttSession.emitTranscript({
      segmentId: "segment-1",
      transcript: "background noise",
      isFinal: true,
      avgLogprob: -2.5,
      isLowConfidence: true,
    });
    await settle();

    expect(host.spokenInput).toEqual([]);
    expect(host.emitted).toContainEqual(
      expect.objectContaining({
        type: "transcription_result",
        payload: expect.objectContaining({
          text: "",
          avgLogprob: -2.5,
          isLowConfidence: true,
        }),
      }),
    );

    await voiceSession.cleanup();
  });
});
