import { OpenAiRealtime, realtimeKey } from "./openai-realtime.js";
import { RealtimeContextStore } from "./realtime-context.js";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import type pino from "pino";
import { getErrorMessage } from "@getpaseo/protocol/error-utils";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import { TTSManager, AudioPlaybackError } from "../../agent/tts-manager.js";
import { STTManager } from "../../agent/stt-manager.js";
import type { SpeechToTextProvider, TextToSpeechProvider } from "../../speech/speech-provider.js";
import type { TurnDetectionProvider } from "../../speech/turn-detection-provider.js";
import { maybePersistTtsDebugAudio } from "../../agent/tts-debug.js";
import { isPaseoDictationDebugEnabled } from "../../agent/recordings-debug.js";
import {
  DictationStreamManager,
  type DictationStreamOutboundMessage,
} from "../../dictation/dictation-stream-manager.js";
import { createVoiceTurnController, type VoiceTurnController } from "./voice-turn-controller.js";
import type { VoiceCallerContext, VoiceSpeakHandler } from "../../voice-types.js";
import type { ManagedAgent } from "../../agent/agent-manager.js";
import type { AgentStreamEvent } from "../../agent/agent-sdk-types.js";
import type { LocalSpeechModelId } from "../../speech/providers/local/models.js";
import { toResolver, type Resolvable } from "../../speech/provider-resolver.js";
import type { SpeechReadinessSnapshot, SpeechReadinessState } from "../../speech/speech-runtime.js";

import { parseVoiceInputCommand } from "./voice-input-command.js";
import {
  resolveVoiceRecognitionIssue,
  type VoiceRecognitionIssue,
} from "./voice-recognition-issue.js";

const PCM_SAMPLE_RATE = 16000;
const PCM_CHANNELS = 1;
const PCM_BITS_PER_SAMPLE = 16;
const PCM_BYTES_PER_MS = (PCM_SAMPLE_RATE * PCM_CHANNELS * (PCM_BITS_PER_SAMPLE / 8)) / 1000;
const MIN_STREAMING_SEGMENT_DURATION_MS = 1000;
const MIN_STREAMING_SEGMENT_BYTES = Math.round(
  PCM_BYTES_PER_MS * MIN_STREAMING_SEGMENT_DURATION_MS,
);
const AgentIdSchema = z.guid();

type ProcessingPhase = "idle" | "transcribing";

interface AudioBufferState {
  chunks: Buffer[];
  format: string;
  isPCM: boolean;
  totalPCMBytes: number;
}

interface VoiceTranscriptionResultPayload {
  text: string;
  requestId: string;
  language?: string;
  duration?: number;
  avgLogprob?: number;
  isLowConfidence?: boolean;
  byteLength?: number;
  format?: string;
  debugRecordingPath?: string;
}

interface VoiceFeatureUnavailableContext {
  reasonCode: SpeechReadinessSnapshot["voiceFeature"]["reasonCode"];
  message: string;
  retryable: boolean;
  missingModelIds: LocalSpeechModelId[];
}

interface VoiceFeatureUnavailableResponseMetadata {
  reasonCode?: SpeechReadinessSnapshot["voiceFeature"]["reasonCode"];
  retryable?: boolean;
  missingModelIds?: LocalSpeechModelId[];
}

class VoiceFeatureUnavailableError extends Error {
  readonly reasonCode: SpeechReadinessSnapshot["voiceFeature"]["reasonCode"];
  readonly retryable: boolean;
  readonly missingModelIds: LocalSpeechModelId[];

  constructor(context: VoiceFeatureUnavailableContext) {
    super(context.message);
    this.name = "VoiceFeatureUnavailableError";
    this.reasonCode = context.reasonCode;
    this.retryable = context.retryable;
    this.missingModelIds = [...context.missingModelIds];
  }
}

function convertPCMToWavBuffer(
  pcmBuffer: Buffer,
  sampleRate: number,
  channels: number,
  bitsPerSample: number,
): Buffer {
  const headerSize = 44;
  const wavBuffer = Buffer.alloc(headerSize + pcmBuffer.length);
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;

  wavBuffer.write("RIFF", 0);
  wavBuffer.writeUInt32LE(36 + pcmBuffer.length, 4);
  wavBuffer.write("WAVE", 8);
  wavBuffer.write("fmt ", 12);
  wavBuffer.writeUInt32LE(16, 16);
  wavBuffer.writeUInt16LE(1, 20);
  wavBuffer.writeUInt16LE(channels, 22);
  wavBuffer.writeUInt32LE(sampleRate, 24);
  wavBuffer.writeUInt32LE(byteRate, 28);
  wavBuffer.writeUInt16LE(blockAlign, 32);
  wavBuffer.writeUInt16LE(bitsPerSample, 34);
  wavBuffer.write("data", 36);
  wavBuffer.writeUInt32LE(pcmBuffer.length, 40);
  pcmBuffer.copy(wavBuffer, 44);

  return wavBuffer;
}

/**
 * The agent-facing operations VoiceSession needs from the session that owns it.
 * VoiceSession owns all voice/audio state; it reaches back through this narrow
 * seam only to deliver transcripts to the agent, drive TTS playback, and
 * manage the audio attachment. Agent work has a separate lifetime.
 */
export interface VoiceSessionHost {
  emit(msg: SessionOutboundMessage): void;
  loadAgent(agentId: string): Promise<ManagedAgent>;
  sendSpokenInput(agentId: string, text: string, messageId: string): Promise<void>;
}

export interface VoiceSessionOptions {
  realtimeHome?: string;
  host: VoiceSessionHost;
  logger: pino.Logger;
  sessionId: string;
  onIdle?: () => void;
  sttLanguage?: string;
  tts: Resolvable<TextToSpeechProvider | null>;
  stt: Resolvable<SpeechToTextProvider | null>;
  voice?: {
    turnDetection?: Resolvable<TurnDetectionProvider | null>;
  };
  voiceBridge?: {
    registerVoiceSpeakHandler?: (
      agentId: string,
      attachmentId: string,
      handler: VoiceSpeakHandler,
      revoke: () => void,
    ) => string;
    unregisterVoiceSpeakHandler?: (agentId: string, generation: string) => void;
    registerVoiceCallerContext?: (
      agentId: string,
      generation: string,
      context: VoiceCallerContext,
    ) => void;
    unregisterVoiceCallerContext?: (agentId: string, generation: string) => void;
    isCurrent?: (agentId: string, generation: string) => boolean;
    hasSpokenInTurn?: (agentId: string, turnId: string) => boolean;
  };
  dictation?: {
    finalTimeoutMs?: number;
    stt?: Resolvable<SpeechToTextProvider | null>;
    sttLanguage?: string;
    getSpeechReadiness?: () => SpeechReadinessSnapshot;
  };
}

/**
 * Owns the voice half of a client session: speech-to-text/text-to-speech
 * managers, dictation streaming, the barge-in audio-buffering state machine,
 * voice-turn detection, and the MCP voice bridge. The session delegates the
 * voice/dictation/abort message types here and otherwise knows nothing about
 * audio buffering or processing phases.
 */
export class VoiceSession {
  private realtime: OpenAiRealtime | null = null;
  private readonly realtimeHome?: string;
  private voiceProvider: "paseo" | "openai-realtime" = "paseo";
  private readonly realtimeAudioDurations = new Map<
    string,
    { responseId: string; duration: number }
  >();
  private readonly host: VoiceSessionHost;
  private readonly sessionLogger: pino.Logger;
  private readonly sessionId: string;
  private readonly sttLanguage: string;

  private abortController: AbortController;
  private closed = false;
  private readonly onIdle: (() => void) | undefined;
  private processingPhase: ProcessingPhase = "idle";

  private isVoiceMode = false;
  private voiceCommandsEnabled = false;
  private controllerSupportsInputCommands = false;
  private inputMuted = false;
  private inputRevision = 0;
  private speechInProgress = false;
  private spokeThisTurn = false;
  private fallbackTurnId: string | null = null;
  private fallbackEpoch: string | null = null;
  private fallbackSeq = -1;
  private requiresTransportToken = false;
  private visibleReply = "";

  private readonly dictationStreamManager: DictationStreamManager;
  private readonly resolveVoiceTurnDetection: () => TurnDetectionProvider | null;
  private voiceTurnController: VoiceTurnController | null = null;
  private voiceInputChunkCount = 0;
  private voiceInputBytes = 0;
  private voiceInputWindowStartedAt = Date.now();

  // Audio buffering for interruption handling
  private pendingAudioSegments: Array<{ audio: Buffer; format: string }> = [];
  private bufferTimeout: ReturnType<typeof setTimeout> | null = null;
  private audioBuffer: AudioBufferState | null = null;

  // Optional TTS debug capture (persisted per utterance)
  private readonly ttsDebugStreams = new Map<string, { format: string; chunks: Buffer[] }>();

  private readonly ttsManager: TTSManager;
  private readonly sttManager: STTManager;

  private readonly registerVoiceSpeakHandler?: (
    agentId: string,
    attachmentId: string,
    handler: VoiceSpeakHandler,
    revoke: () => void,
  ) => string;
  private readonly unregisterVoiceSpeakHandler?: (agentId: string, generation: string) => void;
  private readonly unregisterVoiceCallerContext?: (agentId: string, generation: string) => void;
  private readonly hasSpokenInTurn?: (agentId: string, turnId: string) => boolean;
  private readonly isCurrent?: (agentId: string, generation: string) => boolean;
  private readonly getSpeechReadiness?: () => SpeechReadinessSnapshot;

  private voiceModeAgentId: string | null = null;
  private voiceModeAttachmentId: string | null = null;
  private voiceModeGeneration: string | null = null;

  constructor(options: VoiceSessionOptions) {
    const { host, logger, sessionId, sttLanguage, tts, stt, voice, voiceBridge, dictation } =
      options;
    this.host = host;
    this.realtimeHome = options.realtimeHome;
    this.onIdle = options.onIdle;
    this.sessionLogger = logger;
    this.sessionId = sessionId;
    this.sttLanguage = sttLanguage ?? "en";
    this.abortController = new AbortController();

    this.resolveVoiceTurnDetection = toResolver(voice?.turnDetection ?? null);
    this.registerVoiceSpeakHandler = voiceBridge?.registerVoiceSpeakHandler;
    this.unregisterVoiceSpeakHandler = voiceBridge?.unregisterVoiceSpeakHandler;
    this.unregisterVoiceCallerContext = voiceBridge?.unregisterVoiceCallerContext;
    this.isCurrent = voiceBridge?.isCurrent;
    this.hasSpokenInTurn = voiceBridge?.hasSpokenInTurn;
    this.getSpeechReadiness = dictation?.getSpeechReadiness;

    this.ttsManager = new TTSManager(this.sessionId, this.sessionLogger, tts);
    this.sttManager = new STTManager(this.sessionId, this.sessionLogger, stt, {
      language: sttLanguage,
    });
    this.dictationStreamManager = new DictationStreamManager({
      logger: this.sessionLogger,
      sessionId: this.sessionId,
      emit: (msg) => this.handleDictationManagerMessage(msg),
      stt: dictation?.stt ?? null,
      language: dictation?.sttLanguage,
      finalTimeoutMs: dictation?.finalTimeoutMs,
      onIdle: this.onIdle,
    });
  }

  get hasDemand(): boolean {
    return (
      this.isVoiceMode ||
      this.dictationStreamManager.hasDemand ||
      this.processingPhase !== "idle" ||
      this.audioBuffer !== null ||
      this.pendingAudioSegments.length > 0
    );
  }

  acceptsInput(attachmentId?: string, generation?: string): boolean {
    // COMPAT(voiceConcurrentInput): tokenless legacy attachments, remove after 2027-03-29.
    if (!this.requiresTransportToken && !attachmentId && !generation) return !this.closed;
    return (
      this.currentAttachment() &&
      attachmentId === this.voiceModeAttachmentId &&
      generation === this.voiceModeGeneration
    );
  }

  handleAgentEvent(event: AgentStreamEvent, metadata: { seq?: number; epoch?: string } = {}): void {
    if (!this.currentAttachment()) return;
    if (event.type === "turn_started" && event.turnId && event.turnId !== this.fallbackTurnId) {
      this.fallbackTurnId = event.turnId;
      this.spokeThisTurn = false;
      this.visibleReply = "";
    } else if (event.type === "timeline" && event.item.type === "assistant_message") {
      this.collectVisibleReply(event, metadata);
    } else if (
      (event.type === "turn_completed" ||
        event.type === "turn_failed" ||
        event.type === "turn_canceled") &&
      event.turnId &&
      event.turnId === this.fallbackTurnId
    ) {
      const reply = this.visibleReply.trim();
      if (
        event.type === "turn_completed" &&
        reply &&
        !this.spokeThisTurn &&
        !this.hasSpokenInTurn?.(this.voiceModeAgentId!, event.turnId)
      ) {
        this.spokeThisTurn = true;
        void this.speakFallback(reply);
      }
      this.visibleReply = "";
      this.fallbackTurnId = null;
    }
  }

  private collectVisibleReply(
    event: Extract<AgentStreamEvent, { type: "timeline" }>,
    metadata: { seq?: number; epoch?: string },
  ): void {
    if (event.item.type !== "assistant_message") return;
    if (
      !event.turnId ||
      event.turnId !== this.fallbackTurnId ||
      metadata.seq === undefined ||
      !metadata.epoch
    )
      return;
    if (this.fallbackEpoch && metadata.epoch !== this.fallbackEpoch) {
      this.visibleReply = "";
      this.fallbackSeq = -1;
    }
    if (metadata.seq <= this.fallbackSeq) return;
    this.fallbackEpoch = metadata.epoch;
    this.fallbackSeq = metadata.seq;
    this.visibleReply = (this.visibleReply + event.item.text).slice(0, 4000);
  }

  private async speakFallback(text: string): Promise<void> {
    if (this.realtime) {
      this.realtime.reply(text);
      return;
    }
    try {
      await this.ttsManager.generateAndWaitForPlayback(
        text,
        (message) => this.emit(message),
        this.abortController.signal,
        true,
      );
    } catch (error) {
      this.sessionLogger.warn({ err: error }, "Voice fallback playback failed");
    }
  }

  isActiveForAgent(agentId: string): boolean {
    return this.isVoiceMode && this.voiceModeAgentId === agentId;
  }

  handleDictationChunk(params: {
    dictationId: string;
    seq: number;
    audioBase64: string;
    format: string;
  }): Promise<void> {
    return this.dictationStreamManager.handleChunk(params);
  }

  handleDictationFinish(dictationId: string, finalSeq: number): Promise<void> {
    return this.dictationStreamManager.handleFinish(dictationId, finalSeq);
  }

  handleDictationCancel(dictationId: string): void {
    this.dictationStreamManager.handleCancel(dictationId);
  }

  async handleDictationStreamStart(
    msg: Extract<SessionInboundMessage, { type: "dictation_stream_start" }>,
  ): Promise<void> {
    const unavailable = this.resolveVoiceFeatureUnavailableContext("dictation");
    if (unavailable) {
      this.emit({
        type: "dictation_stream_error",
        payload: {
          dictationId: msg.dictationId,
          error: unavailable.message,
          retryable: unavailable.retryable,
          reasonCode: unavailable.reasonCode,
          missingModelIds: unavailable.missingModelIds,
        },
      });
      return;
    }
    await this.dictationStreamManager.handleStart(msg.dictationId, msg.format);
  }

  private toVoiceFeatureUnavailableContext(
    state: SpeechReadinessState,
  ): VoiceFeatureUnavailableContext {
    return {
      reasonCode: state.reasonCode,
      message: state.message,
      retryable: state.retryable,
      missingModelIds: [...state.missingModelIds],
    };
  }

  private resolveModeReadinessState(
    readiness: SpeechReadinessSnapshot,
    mode: "voice_mode" | "dictation",
  ): SpeechReadinessState {
    if (mode === "voice_mode") {
      return readiness.realtimeVoice;
    }
    return readiness.dictation;
  }

  private getVoiceFeatureUnavailableResponseMetadata(
    error: unknown,
  ): VoiceFeatureUnavailableResponseMetadata {
    if (!(error instanceof VoiceFeatureUnavailableError)) {
      return {};
    }
    return {
      reasonCode: error.reasonCode,
      retryable: error.retryable,
      missingModelIds: error.missingModelIds,
    };
  }

  private resolveVoiceFeatureUnavailableContext(
    mode: "voice_mode" | "dictation",
  ): VoiceFeatureUnavailableContext | null {
    const readiness = this.getSpeechReadiness?.();
    if (!readiness) {
      return null;
    }

    const modeReadiness = this.resolveModeReadinessState(readiness, mode);
    if (!modeReadiness.enabled) {
      return this.toVoiceFeatureUnavailableContext(modeReadiness);
    }
    if (!readiness.voiceFeature.available) {
      return this.toVoiceFeatureUnavailableContext(readiness.voiceFeature);
    }
    if (!modeReadiness.available) {
      return this.toVoiceFeatureUnavailableContext(modeReadiness);
    }
    return null;
  }

  /**
   * Handle voice mode toggle
   */
  // Attachment ownership and controller startup must share one failure cleanup path.
  // oxlint-disable-next-line complexity
  async handleSetVoiceMode(
    enabled: boolean,
    agentId?: string,
    requestId?: string,
    input: {
      voiceProvider?: "paseo" | "openai-realtime";
      voiceCommandsEnabled?: boolean;
      isMuted?: boolean;
      attachmentId?: string;
      generation?: string;
    } = {},
  ): Promise<void> {
    const startedAt = Date.now();
    try {
      this.sessionLogger.info(
        { enabled, requestedAgentId: agentId ?? null, requestId: requestId ?? null },
        "set_voice_mode started",
      );
      if (
        !enabled &&
        this.voiceModeAgentId &&
        !this.acceptsInput(input.attachmentId, input.generation)
      ) {
        throw new Error("Voice attachment is no longer owned by this request.");
      }
      if (enabled) {
        const requestedProvider = input.voiceProvider ?? "paseo";
        const unavailable =
          requestedProvider === "paseo"
            ? this.resolveVoiceFeatureUnavailableContext("voice_mode")
            : null;
        if (unavailable) {
          throw new VoiceFeatureUnavailableError(unavailable);
        }

        const normalizedAgentId = this.parseVoiceTargetAgentId(agentId ?? "", "set_voice_mode");
        const duplicate =
          this.isVoiceMode &&
          this.requiresTransportToken &&
          this.voiceModeAgentId === normalizedAgentId &&
          this.voiceModeAttachmentId === input.attachmentId;

        if (
          this.isVoiceMode &&
          this.voiceModeAgentId &&
          (this.voiceProvider !== requestedProvider ||
            this.voiceModeAgentId !== normalizedAgentId ||
            (input.attachmentId && input.attachmentId !== this.voiceModeAttachmentId))
        ) {
          this.sessionLogger.info(
            {
              previousAgentId: this.voiceModeAgentId,
              nextAgentId: normalizedAgentId,
              elapsedMs: Date.now() - startedAt,
            },
            "set_voice_mode disabling previous active voice agent",
          );
          await this.disableVoiceModeForActiveAgent();
          this.isVoiceMode = false;
        }

        this.voiceProvider = requestedProvider;
        if (!this.isVoiceMode || this.voiceModeAgentId !== normalizedAgentId) {
          this.requiresTransportToken = !!input.attachmentId;
          this.voiceModeAttachmentId = input.attachmentId ?? uuidv4();
          this.createAbortController();
          this.sessionLogger.info(
            { agentId: normalizedAgentId, elapsedMs: Date.now() - startedAt },
            "set_voice_mode enabling voice for agent",
          );
          const refreshedAgentId = await this.enableVoiceModeForAgent(normalizedAgentId);
          this.voiceModeAgentId = refreshedAgentId;
          if (this.closed) {
            await this.disableVoiceModeForActiveAgent();
            return;
          }
          this.sessionLogger.info(
            { agentId: refreshedAgentId, elapsedMs: Date.now() - startedAt },
            "set_voice_mode agent enable complete",
          );
        }

        this.sessionLogger.info(
          { agentId: this.voiceModeAgentId, elapsedMs: Date.now() - startedAt },
          "set_voice_mode starting voice turn controller",
        );
        if (this.voiceProvider === "openai-realtime") {
          await this.startRealtime(input.isMuted);
        } else {
          await this.startVoiceTurnController();
        }
        this.sessionLogger.info(
          { agentId: this.voiceModeAgentId, elapsedMs: Date.now() - startedAt },
          "set_voice_mode voice turn controller started",
        );
        if (this.closed) {
          await this.disableVoiceModeForActiveAgent();
          return;
        }
        this.isVoiceMode = !this.closed;
        if (this.realtime) {
          this.voiceCommandsEnabled = false;
          this.inputMuted = this.realtime.status().muted;
        } else if (!duplicate) await this.configureInputCommands(input);
        this.sessionLogger.info(
          {
            agentId: this.voiceModeAgentId,
            elapsedMs: Date.now() - startedAt,
          },
          "Voice mode enabled for existing agent",
        );
        if (requestId) {
          this.emit({
            type: "set_voice_mode_response",
            payload: {
              requestId,
              enabled: true,
              ...(this.realtime ? { realtime: this.realtime.status() } : {}),
              voiceCommandsEnabled: this.voiceCommandsEnabled,
              isMuted: this.inputMuted,
              agentId: this.voiceModeAgentId,
              ...(this.voiceModeAttachmentId ? { attachmentId: this.voiceModeAttachmentId } : {}),
              ...(this.voiceModeGeneration ? { generation: this.voiceModeGeneration } : {}),
              accepted: true,
              error: null,
            },
          });
        }
        return;
      }

      this.sessionLogger.info(
        { agentId: this.voiceModeAgentId, elapsedMs: Date.now() - startedAt },
        "set_voice_mode disabling active voice mode",
      );
      await this.disableVoiceModeForActiveAgent();
      this.isVoiceMode = false;
      this.voiceCommandsEnabled = false;
      this.inputMuted = false;
      this.sessionLogger.info({ elapsedMs: Date.now() - startedAt }, "Voice mode disabled");
      if (requestId) {
        this.emit({
          type: "set_voice_mode_response",
          payload: {
            requestId,
            enabled: false,
            agentId: null,
            accepted: true,
            error: null,
          },
        });
      }
    } catch (error) {
      if (!this.isVoiceMode && this.voiceModeAgentId) {
        await this.disableVoiceModeForActiveAgent();
      }
      const errorMessage = error instanceof Error ? error.message : "Failed to set voice mode";
      const unavailable = this.getVoiceFeatureUnavailableResponseMetadata(error);
      this.sessionLogger.error(
        {
          err: error,
          enabled,
          requestedAgentId: agentId ?? null,
          elapsedMs: Date.now() - startedAt,
        },
        "set_voice_mode failed",
      );
      if (requestId) {
        this.emit({
          type: "set_voice_mode_response",
          payload: {
            requestId,
            enabled: this.isVoiceMode,
            agentId: this.voiceModeAgentId,
            accepted: false,
            error: errorMessage,
            ...unavailable,
          },
        });
        return;
      }
      throw error;
    }
  }

  private async startRealtime(muted?: boolean): Promise<void> {
    if (this.realtime) return;
    if (!this.realtimeHome || !this.voiceModeAgentId)
      throw new Error("GPT Realtime host storage unavailable");
    const agentId = this.voiceModeAgentId;
    this.realtime = new OpenAiRealtime({
      store: new RealtimeContextStore(this.realtimeHome, agentId),
      key: realtimeKey,
      host: {
        status: (realtime) => {
          this.inputMuted = realtime.muted;
          this.emit({
            type: "voice_input_state",
            payload: { isSpeaking: false, isMuted: realtime.muted, realtime },
          });
        },
        speech: (isSpeaking) => this.emit({ type: "voice_input_state", payload: { isSpeaking } }),
        stopPlayback: () => this.emit({ type: "voice_input_state", payload: { isSpeaking: true } }),
        audio: (responseId, audio, index, last) => {
          const id = `${responseId}-${index}`;
          this.realtimeAudioDurations.set(id, {
            responseId,
            duration: Buffer.byteLength(audio, "base64") / 48,
          });
          this.emit({
            type: "audio_output",
            payload: {
              id,
              audio,
              format: "audio/pcm;rate=24000;bits=16",
              isVoiceMode: true,
              groupId: responseId,
              chunkIndex: index,
              isLastChunk: last,
            },
          });
        },
        submit: async (text, messageId) => {
          if (!this.currentAttachment()) throw new Error("Voice attachment ended before admission");
          await this.host.sendSpokenInput(agentId, text, messageId);
          this.emit({
            type: "transcription_result",
            payload: { text, requestId: messageId, messageId, queued: true },
          });
        },
        endVoice: () => {
          const realtime = this.realtime?.status();
          if (realtime)
            this.emit({
              type: "voice_input_state",
              payload: {
                isSpeaking: false,
                realtime: { ...realtime, connection: "off", muted: true },
              },
            });
          void this.disableVoiceModeForActiveAgent();
        },
      },
    });
    await this.realtime.start(muted);
  }

  async handleRealtimeControl(
    input: Extract<SessionInboundMessage, { type: "voice.realtime.control.request" }>,
  ): Promise<void> {
    try {
      if (!this.acceptsInput(input.attachmentId, input.generation) || !this.realtime)
        throw new Error("GPT Realtime attachment is unavailable");
      if (input.expectedEpoch !== this.realtime.status().epoch && input.action !== "clear")
        throw new Error("Voice context changed");
      switch (input.action) {
        case "listen":
          this.realtime.listen();
          break;
        case "focus_agent":
          this.realtime.focus("agent");
          break;
        case "back_to_assistant":
          this.realtime.focus("assistant");
          break;
        case "end_listening":
          await this.realtime.endListening();
          break;
        case "clear":
          await this.realtime.clear(input.expectedEpoch, input.requestId);
          break;
        case "retry":
          await this.realtime.start(true);
          break;
      }
      this.emit({
        type: "voice.realtime.control.response",
        payload: { requestId: input.requestId, state: this.realtime.status(), error: null },
      });
    } catch {
      this.emit({
        type: "voice.realtime.control.response",
        payload: {
          requestId: input.requestId,
          state: this.realtime?.status() ?? null,
          error: "Voice control failed. Context retained; retry after reconnecting.",
        },
      });
    }
  }

  private parseVoiceTargetAgentId(rawId: string, source: string): string {
    const parsed = AgentIdSchema.safeParse(rawId.trim());
    if (!parsed.success) {
      throw new Error(`${source}: agentId must be a UUID`);
    }
    return parsed.data;
  }

  private async enableVoiceModeForAgent(agentId: string): Promise<string> {
    const startedAt = Date.now();
    this.sessionLogger.info({ agentId }, "enableVoiceModeForAgent.ensureAgentLoaded.start");
    const existing = await this.host.loadAgent(agentId);
    if (this.closed) throw new Error("Voice source is closed");
    this.sessionLogger.info(
      { agentId, elapsedMs: Date.now() - startedAt },
      "enableVoiceModeForAgent.ensureAgentLoaded.done",
    );

    this.registerVoiceBridgeForAgent(agentId);
    this.fallbackTurnId = existing.activeForegroundTurnId ?? null;
    return existing.id;
  }

  private async disableVoiceModeForActiveAgent(): Promise<void> {
    this.realtime?.stop();
    this.realtime = null;
    this.realtimeAudioDurations.clear();
    this.isVoiceMode = false;
    this.inputRevision += 1;
    this.abortController.abort();
    this.visibleReply = "";
    this.fallbackTurnId = null;
    this.spokeThisTurn = false;
    this.fallbackEpoch = null;
    this.fallbackSeq = -1;
    await this.stopVoiceTurnController();
    this.ttsManager.cancelPendingPlaybacks("voice mode disabled");

    const agentId = this.voiceModeAgentId;
    if (!agentId) return;

    if (this.voiceModeGeneration) {
      this.unregisterVoiceSpeakHandler?.(agentId, this.voiceModeGeneration);
      this.unregisterVoiceCallerContext?.(agentId, this.voiceModeGeneration);
    }
    this.voiceModeAgentId = null;
    this.voiceModeAttachmentId = null;
    this.voiceModeGeneration = null;
  }

  private async configureInputCommands(input: {
    voiceCommandsEnabled?: boolean;
    isMuted?: boolean;
  }): Promise<void> {
    this.voiceCommandsEnabled =
      input.voiceCommandsEnabled === true && this.controllerSupportsInputCommands;
    this.inputMuted = this.voiceCommandsEnabled && input.isMuted === true;
    this.inputRevision += 1;
    await this.voiceTurnController?.resetInput(this.inputMuted);
  }

  async handleSetInputMuted(input: {
    muted: boolean;
    requestId: string;
    attachmentId?: string;
    generation?: string;
  }): Promise<void> {
    if (!this.acceptsInput(input.attachmentId, input.generation)) {
      this.emit({
        type: "voice.input.set_muted.response",
        payload: {
          requestId: input.requestId,
          muted: this.inputMuted,
          error: "Voice attachment is no longer owned by this request.",
        },
      });
      return;
    }
    if (this.realtime && this.isVoiceMode) {
      this.realtime.mute(input.muted);
      this.emit({
        type: "voice.input.set_muted.response",
        payload: { requestId: input.requestId, muted: input.muted, error: null },
      });
      return;
    }
    if (!this.isVoiceMode || !this.voiceCommandsEnabled) {
      this.emit({
        type: "voice.input.set_muted.response",
        payload: {
          requestId: input.requestId,
          muted: this.inputMuted,
          error: "Verbal mute requires an active voice session with local speech recognition.",
        },
      });
      return;
    }
    this.setInputMuted(input.muted);
    let error: string | null = null;
    try {
      await this.voiceTurnController?.resetInput(this.inputMuted);
    } catch (cause) {
      error = getErrorMessage(cause);
    }
    this.emit({
      type: "voice.input.set_muted.response",
      payload: { requestId: input.requestId, muted: this.inputMuted, error },
    });
  }

  private setInputMuted(muted: boolean): void {
    this.inputRevision += 1;
    this.inputMuted = muted;
    this.pendingAudioSegments = [];
    this.audioBuffer = null;
    this.clearBufferTimeout();
    this.clearSpeechInProgress("microphone mute changed");
    this.setPhase("idle");
    this.emit({ type: "voice_input_state", payload: { isSpeaking: false, isMuted: muted } });
  }

  private handleDictationManagerMessage(msg: DictationStreamOutboundMessage): void {
    this.emit(msg as unknown as SessionOutboundMessage);
  }

  private async startVoiceTurnController(): Promise<void> {
    if (this.voiceTurnController) {
      this.sessionLogger.info("startVoiceTurnController skipped: already running");
      return;
    }

    const turnDetection = this.resolveVoiceTurnDetection();
    if (!turnDetection) {
      throw new Error("Voice turn detection is not configured");
    }
    const stt = this.sttManager.getProvider();
    if (!stt) {
      throw new Error("Voice speech-to-text is not configured");
    }

    this.sessionLogger.info(
      { providerId: turnDetection.id },
      "startVoiceTurnController creating controller",
    );

    const controllerGeneration = this.voiceModeGeneration;
    const isCurrentController = () =>
      this.currentAttachment() && controllerGeneration === this.voiceModeGeneration;
    const controller = createVoiceTurnController({
      logger: this.sessionLogger.child({ component: "voice-turn-controller" }),
      turnDetection,
      stt,
      sttLanguage: this.sttLanguage,
      callbacks: {
        onSpeechStarted: async () => {
          if (!isCurrentController()) return;
          // Voice STT providers return final transcripts only. Use the detector's
          // confirmed speech event so interruption does not wait for transcription.
          this.sessionLogger.debug("Voice VAD speech_started");
          if (this.inputMuted) return;
          this.emit({
            type: "voice_input_state",
            payload: {
              isSpeaking: true,
            },
          });
          // With verbal commands enabled the utterance may be "mute microphone", so
          // barge-in waits for the final transcript (see onTranscript) instead.
          if (this.voiceCommandsEnabled) return;
          await this.handleVoiceSpeechStart();
        },
        onPartialTranscript: async ({ segmentId, transcript }) => {
          this.sessionLogger.debug(
            { segmentId, transcriptLength: transcript.trim().length },
            "Voice partial transcript",
          );
        },
        onSpeechStopped: async () => {
          if (!isCurrentController()) return;
          if (this.inputMuted || this.voiceCommandsEnabled) return;
          this.handleVoiceSpeechStopped();
          this.setPhase("transcribing");
          this.emit({
            type: "activity_log",
            payload: {
              id: uuidv4(),
              timestamp: new Date(),
              type: "system",
              content: "Transcribing audio...",
            },
          });
        },
        onFinalTranscript: async ({
          utteranceId,
          transcript,
          language,
          durationMs,
          speechMs,
          timedOut,
          avgLogprob,
          isLowConfidence,
        }) => {
          if (!isCurrentController()) return;
          const requestId = `${controllerGeneration}:${utteranceId}`;
          const transcriptText = isLowConfidence ? "" : transcript.trim();
          const recognitionIssue = this.resolveRecognitionIssue({
            transcript: transcriptText,
            speechMs,
            timedOut,
          });
          if (this.voiceCommandsEnabled) {
            const command = parseVoiceInputCommand(transcriptText);
            if (command || this.inputMuted) {
              if (command === "unmute" || (command === "mute" && !this.inputMuted)) {
                this.setInputMuted(command === "mute");
                // The callback runs inside the controller queue; do not await its reset here.
                // Reset failures are already surfaced by the controller's onError callback.
                void this.voiceTurnController?.resetInput(this.inputMuted).catch(() => undefined);
              }
              if (this.isVoiceMode) this.emitRecognitionIssue(recognitionIssue);
              return;
            }
          }
          if (!this.isVoiceMode) return;
          if (isLowConfidence) {
            this.sessionLogger.debug(
              { text: transcript, avgLogprob },
              "Filtered low-confidence transcription (likely non-speech)",
            );
          }
          this.sessionLogger.info(
            {
              requestId,
              isVoiceMode: this.isVoiceMode,
              transcriptLength: transcriptText.length,
              transcript: transcriptText,
            },
            "Transcription result",
          );
          const revision = this.inputRevision;
          if (this.voiceCommandsEnabled && transcriptText) {
            await this.handleVoiceSpeechStart();
          }
          if (revision !== this.inputRevision || !isCurrentController()) return;
          this.handleVoiceSpeechStopped();
          await this.handleTranscriptionResultPayload({
            text: transcriptText,
            requestId,
            ...(language ? { language } : {}),
            duration: durationMs,
            ...(avgLogprob !== undefined ? { avgLogprob } : {}),
            ...(isLowConfidence !== undefined ? { isLowConfidence } : {}),
          });
          // After the empty transcription_result, which returns the app to listening.
          this.emitRecognitionIssue(recognitionIssue);
        },
        onError: (error) => {
          if (!isCurrentController()) return;
          this.sessionLogger.error({ err: error }, "Voice turn controller failed");
          if (this.voiceCommandsEnabled) {
            this.emit({
              type: "voice_input_state",
              payload: {
                isSpeaking: false,
                isMuted: this.inputMuted,
                error: "Speech recognition failed. Stop and restart voice to reconnect.",
                recognitionIssue: "failed",
              },
            });
          } else {
            // Without `error`, clients keep uploading so the controller's reconnect can recover.
            this.emitRecognitionIssue("failed");
          }
        },
      },
    });

    this.sessionLogger.info("startVoiceTurnController connecting controller");
    this.voiceTurnController = controller;
    await controller.start();
    if (this.closed) await controller.stop();
    this.controllerSupportsInputCommands = stt.id === "local" && turnDetection.id === "local";
    this.sessionLogger.info("startVoiceTurnController connected");
  }

  private async stopVoiceTurnController(): Promise<void> {
    if (!this.voiceTurnController) {
      return;
    }

    const controller = this.voiceTurnController;
    this.voiceTurnController = null;
    this.controllerSupportsInputCommands = false;
    await controller.stop();
  }

  private resolveRecognitionIssue(input: {
    transcript: string;
    speechMs: number;
    timedOut: boolean;
  }): VoiceRecognitionIssue | null {
    const recognitionIssue = resolveVoiceRecognitionIssue({
      ...input,
      inputMuted: this.inputMuted,
    });
    if (recognitionIssue) {
      this.sessionLogger.warn(
        { recognitionIssue, speechMs: input.speechMs, timedOut: input.timedOut },
        "Voice utterance produced no text",
      );
    }
    return recognitionIssue;
  }

  private emitRecognitionIssue(recognitionIssue: VoiceRecognitionIssue | null): void {
    if (!recognitionIssue) return;
    this.emit({ type: "voice_input_state", payload: { isSpeaking: false, recognitionIssue } });
  }

  private handleVoiceSpeechStopped(): void {
    this.sessionLogger.info("voice_input_state emitting isSpeaking=false");
    this.emit({
      type: "voice_input_state",
      payload: {
        isSpeaking: false,
      },
    });
  }

  private async ensureAudioBufferForFormat(
    chunkFormat: string,
    isPCMChunk: boolean,
  ): Promise<AudioBufferState> {
    if (!this.audioBuffer) {
      this.audioBuffer = {
        chunks: [],
        format: chunkFormat,
        isPCM: isPCMChunk,
        totalPCMBytes: 0,
      };
      return this.audioBuffer;
    }
    if (this.audioBuffer.isPCM !== isPCMChunk) {
      this.sessionLogger.debug(
        {
          oldFormat: this.audioBuffer.isPCM ? "pcm" : this.audioBuffer.format,
          newFormat: chunkFormat,
        },
        `Audio format changed mid-stream, flushing current buffer`,
      );
      const finalized = this.finalizeBufferedAudio();
      if (finalized) {
        await this.processCompletedAudio(finalized.audio, finalized.format);
      }
      this.audioBuffer = {
        chunks: [],
        format: chunkFormat,
        isPCM: isPCMChunk,
        totalPCMBytes: 0,
      };
      return this.audioBuffer;
    }
    if (!this.audioBuffer.isPCM) {
      this.audioBuffer.format = chunkFormat;
    }
    return this.audioBuffer;
  }

  private async forwardAudioChunkToVoiceTurn(
    msg: Extract<SessionInboundMessage, { type: "voice_audio_chunk" }>,
    chunkFormat: string,
  ): Promise<void> {
    if (!this.voiceTurnController) {
      throw new Error("Voice mode is enabled but the voice turn controller is not running");
    }
    const chunkBytes = Buffer.byteLength(msg.audio, "base64");
    this.voiceInputChunkCount += 1;
    this.voiceInputBytes += chunkBytes;
    const now = Date.now();
    if (this.voiceInputChunkCount % 50 === 0 || now - this.voiceInputWindowStartedAt >= 1000) {
      this.sessionLogger.info(
        {
          chunkCount: this.voiceInputChunkCount,
          audioBytes: this.voiceInputBytes,
          windowMs: now - this.voiceInputWindowStartedAt,
          format: chunkFormat,
        },
        "Voice input chunk summary",
      );
      this.voiceInputWindowStartedAt = now;
      this.voiceInputChunkCount = 0;
      this.voiceInputBytes = 0;
    }
    await this.voiceTurnController.appendClientChunk({
      audioBase64: msg.audio,
      format: chunkFormat,
    });
  }

  // Keep cloud and legacy capture admission together at this existing boundary.
  // oxlint-disable-next-line complexity
  async handleAudioChunk(
    msg: Extract<SessionInboundMessage, { type: "voice_audio_chunk" }>,
  ): Promise<void> {
    if (!this.isVoiceMode) {
      this.sessionLogger.warn(
        "Received voice_audio_chunk while voice mode is disabled; transcript will be emitted but voice assistant turn is skipped",
      );
    }

    if (this.realtime) {
      this.realtime.append(msg.audio, msg.format);
      return;
    }
    const chunkFormat = msg.format || "audio/wav";

    if (this.isVoiceMode) {
      await this.forwardAudioChunkToVoiceTurn(msg, chunkFormat);
      return;
    }

    const chunkBuffer = Buffer.from(msg.audio, "base64");
    const isPCMChunk = chunkFormat.toLowerCase().includes("pcm");

    const buffer = await this.ensureAudioBufferForFormat(chunkFormat, isPCMChunk);

    buffer.chunks.push(chunkBuffer);
    if (buffer.isPCM) {
      buffer.totalPCMBytes += chunkBuffer.length;
    }

    // In non-voice mode, use streaming threshold to process chunks
    const reachedStreamingThreshold =
      !this.isVoiceMode && buffer.isPCM && buffer.totalPCMBytes >= MIN_STREAMING_SEGMENT_BYTES;

    if (!msg.isLast && reachedStreamingThreshold) {
      return;
    }

    const bufferedState = this.audioBuffer;
    const finalized = this.finalizeBufferedAudio();
    if (!finalized) {
      return;
    }

    if (!msg.isLast && reachedStreamingThreshold) {
      this.sessionLogger.debug(
        {
          minDuration: MIN_STREAMING_SEGMENT_DURATION_MS,
          pcmBytes: bufferedState?.totalPCMBytes ?? 0,
        },
        `Minimum chunk duration reached (~${MIN_STREAMING_SEGMENT_DURATION_MS}ms, ${
          bufferedState?.totalPCMBytes ?? 0
        } PCM bytes) – triggering STT`,
      );
    } else {
      this.sessionLogger.debug(
        { audioBytes: finalized.audio.length, chunks: bufferedState?.chunks.length ?? 0 },
        `Complete audio segment (${finalized.audio.length} bytes, ${bufferedState?.chunks.length ?? 0} chunk(s))`,
      );
    }

    await this.processCompletedAudio(finalized.audio, finalized.format);
  }

  private finalizeBufferedAudio(): { audio: Buffer; format: string } | null {
    if (!this.audioBuffer) {
      return null;
    }

    const bufferState = this.audioBuffer;
    this.audioBuffer = null;

    if (bufferState.isPCM) {
      const pcmBuffer = Buffer.concat(bufferState.chunks);
      const wavBuffer = convertPCMToWavBuffer(
        pcmBuffer,
        PCM_SAMPLE_RATE,
        PCM_CHANNELS,
        PCM_BITS_PER_SAMPLE,
      );
      return {
        audio: wavBuffer,
        format: "audio/wav",
      };
    }

    return {
      audio: Buffer.concat(bufferState.chunks),
      format: bufferState.format,
    };
  }

  private async processCompletedAudio(audio: Buffer, format: string): Promise<void> {
    if (this.processingPhase === "transcribing") {
      this.sessionLogger.debug(
        { phase: this.processingPhase, segmentCount: this.pendingAudioSegments.length + 1 },
        `Buffering audio segment (phase: ${this.processingPhase})`,
      );
      this.pendingAudioSegments.push({
        audio,
        format,
      });
      this.setBufferTimeout();
      return;
    }

    if (this.pendingAudioSegments.length > 0) {
      this.pendingAudioSegments.push({
        audio,
        format,
      });
      this.sessionLogger.debug(
        { segmentCount: this.pendingAudioSegments.length },
        `Processing ${this.pendingAudioSegments.length} buffered segments together`,
      );

      const pendingSegments = [...this.pendingAudioSegments];
      this.pendingAudioSegments = [];
      this.clearBufferTimeout();

      const combinedAudio = Buffer.concat(pendingSegments.map((segment) => segment.audio));
      const combinedFormat = pendingSegments[pendingSegments.length - 1].format;

      await this.processAudio(combinedAudio, combinedFormat);
      return;
    }

    await this.processAudio(audio, format);
  }

  private async flushPendingAudioSegments(reason: string): Promise<void> {
    if (this.processingPhase === "transcribing" || this.pendingAudioSegments.length === 0) {
      return;
    }

    const pendingSegments = [...this.pendingAudioSegments];
    this.pendingAudioSegments = [];
    this.clearBufferTimeout();

    this.sessionLogger.debug(
      { reason, segmentCount: pendingSegments.length },
      `Flushing ${pendingSegments.length} buffered audio segment(s)`,
    );

    const combinedAudio = Buffer.concat(pendingSegments.map((segment) => segment.audio));
    const combinedFormat = pendingSegments[pendingSegments.length - 1].format;

    await this.processAudio(combinedAudio, combinedFormat);
  }

  /**
   * Process audio through STT and then LLM
   */
  private async processAudio(audio: Buffer, format: string): Promise<void> {
    this.setPhase("transcribing");

    this.emit({
      type: "activity_log",
      payload: {
        id: uuidv4(),
        timestamp: new Date(),
        type: "system",
        content: "Transcribing audio...",
      },
    });

    try {
      const requestId = uuidv4();
      const result = await this.sttManager.transcribe(audio, format, {
        requestId,
        label: this.isVoiceMode ? "voice" : "buffered",
      });

      const transcriptText = result.text.trim();
      this.sessionLogger.info(
        {
          requestId,
          isVoiceMode: this.isVoiceMode,
          transcriptLength: transcriptText.length,
          transcript: transcriptText,
        },
        "Transcription result",
      );

      await this.handleTranscriptionResultPayload({
        text: result.text,
        language: result.language,
        duration: result.duration,
        requestId,
        avgLogprob: result.avgLogprob,
        isLowConfidence: result.isLowConfidence,
        byteLength: result.byteLength,
        format: result.format,
        debugRecordingPath: result.debugRecordingPath,
      });
    } catch (error) {
      this.setPhase("idle");
      this.clearSpeechInProgress("transcription error");
      await this.flushPendingAudioSegments("transcription error");
      this.emit({
        type: "activity_log",
        payload: {
          id: uuidv4(),
          timestamp: new Date(),
          type: "error",
          content: `Transcription error: ${getErrorMessage(error)}`,
        },
      });
      throw error;
    }
  }

  private async handleTranscriptionResultPayload(
    result: VoiceTranscriptionResultPayload,
  ): Promise<void> {
    if (this.inputMuted) return;
    const transcriptText = result.text.trim();

    const emitTranscript = (messageId?: string) =>
      this.emit({
        type: "transcription_result",
        payload: {
          text: result.text,
          ...(result.language ? { language: result.language } : {}),
          ...(result.duration !== undefined ? { duration: result.duration } : {}),
          requestId: result.requestId,
          ...(messageId ? { messageId, queued: true } : {}),
          ...(result.avgLogprob !== undefined ? { avgLogprob: result.avgLogprob } : {}),
          ...(result.isLowConfidence !== undefined
            ? { isLowConfidence: result.isLowConfidence }
            : {}),
          ...(result.byteLength !== undefined ? { byteLength: result.byteLength } : {}),
          ...(result.format ? { format: result.format } : {}),
          ...(result.debugRecordingPath ? { debugRecordingPath: result.debugRecordingPath } : {}),
        },
      });

    if (!transcriptText) {
      emitTranscript();
      this.sessionLogger.debug("Empty transcription (false positive), not aborting");
      this.setPhase("idle");
      this.clearSpeechInProgress("empty transcription");
      await this.flushPendingAudioSegments("empty transcription");
      return;
    }

    // Has content - abort any in-progress stream now
    this.createAbortController();

    if (result.debugRecordingPath) {
      this.emit({
        type: "activity_log",
        payload: {
          id: uuidv4(),
          timestamp: new Date(),
          type: "system",
          content: `Saved input audio: ${result.debugRecordingPath}`,
          metadata: {
            recordingPath: result.debugRecordingPath,
            ...(result.format ? { format: result.format } : {}),
            requestId: result.requestId,
          },
        },
      });
    }

    this.clearSpeechInProgress("transcription complete");
    this.setPhase("idle");
    if (!this.isVoiceMode) {
      this.sessionLogger.debug(
        { requestId: result.requestId },
        "Skipping voice agent processing because voice mode is disabled",
      );
      await this.flushPendingAudioSegments("voice mode disabled");
      return;
    }

    const agentId = this.voiceModeAgentId;
    if (!agentId) {
      this.sessionLogger.warn(
        { requestId: result.requestId },
        "Skipping voice agent processing because no agent is currently voice-enabled",
      );
      await this.flushPendingAudioSegments("no active voice agent");
      return;
    }

    if (!this.currentAttachment()) return;
    const messageId = `${this.voiceModeAttachmentId}:${result.requestId}`;
    try {
      await this.host.sendSpokenInput(agentId, result.text, messageId);
    } catch (error) {
      this.emit({
        type: "voice_input_state",
        payload: { isSpeaking: false, error: `Could not queue speech: ${getErrorMessage(error)}` },
      });
      return;
    }
    emitTranscript(messageId);
    this.emit({
      type: "activity_log",
      payload: {
        id: uuidv4(),
        timestamp: new Date(),
        type: "transcript",
        content: result.text,
        metadata: { messageId },
      },
    });
    await this.flushPendingAudioSegments("transcription complete");
  }

  private registerVoiceBridgeForAgent(agentId: string): void {
    const attachmentId = this.voiceModeAttachmentId;
    let handlerGeneration: string | null = null;
    const handler: VoiceSpeakHandler = async ({ text, signal }) => {
      if (
        !this.currentAttachment() ||
        attachmentId !== this.voiceModeAttachmentId ||
        handlerGeneration !== this.voiceModeGeneration
      )
        return { ok: false, reason: "unavailable" };
      this.spokeThisTurn = true;
      if (this.realtime) {
        this.realtime.reply(text);
        return;
      }
      this.sessionLogger.info(
        {
          agentId,
          textLength: text.length,
          preview: text.slice(0, 160),
        },
        "Voice speak tool call received by session handler",
      );
      const abortSignal = signal
        ? AbortSignal.any([signal, this.abortController.signal])
        : this.abortController.signal;
      try {
        await this.ttsManager.generateAndWaitForPlayback(
          text,
          (msg) => this.emit(msg),
          abortSignal,
          true,
        );
      } catch (error) {
        // An interruption (barge-in, abort, voice stop) ends the speak call quietly, as
        // upstream's speak contract expects. Timeouts and client playback failures still
        // reject so a stalled relay surfaces instead of hanging the tool call.
        if (error instanceof AudioPlaybackError && error.reason === "interrupted") {
          this.sessionLogger.info({ agentId }, "Voice speak tool call interrupted");
          return { ok: false, reason: "interrupted" };
        }
        throw error;
      }
      this.sessionLogger.info(
        { agentId, textLength: text.length },
        "Voice speak tool call finished playback",
      );
      this.emit({
        type: "activity_log",
        payload: {
          id: uuidv4(),
          timestamp: new Date(),
          type: "assistant",
          content: text,
        },
      });
    };

    this.voiceModeGeneration =
      this.registerVoiceSpeakHandler?.(
        agentId,
        this.voiceModeAttachmentId ?? uuidv4(),
        handler,
        () => {
          void this.cleanup().catch((error) =>
            this.sessionLogger.warn({ err: error }, "Failed to revoke old voice attachment"),
          );
        },
      ) ?? uuidv4();
    handlerGeneration = this.voiceModeGeneration;
  }

  private currentAttachment(): boolean {
    return (
      !this.closed &&
      this.isVoiceMode &&
      !!this.voiceModeAgentId &&
      !!this.voiceModeGeneration &&
      (this.isCurrent?.(this.voiceModeAgentId, this.voiceModeGeneration) ?? true)
    );
  }

  /**
   * Handle abort request from client
   */
  async handleAbort(): Promise<void> {
    if (this.realtime) {
      this.realtime.interrupt();
      return;
    }
    this.sessionLogger.info(
      { phase: this.processingPhase },
      `Abort request, phase: ${this.processingPhase}`,
    );

    this.abortController.abort();
    this.ttsManager.cancelPendingPlaybacks("abort request");
    this.createAbortController();

    if (this.processingPhase === "transcribing") {
      // Still in STT phase - we'll buffer the next audio
      this.sessionLogger.debug("Will buffer next audio (currently transcribing)");
      // Phase stays as 'transcribing', handleAudioChunk will handle buffering
      return;
    }

    // Reset phase to idle and clear pending non-voice buffers.
    this.setPhase("idle");
    this.pendingAudioSegments = [];
    this.clearBufferTimeout();
  }

  /**
   * Handle audio playback confirmation from client
   */
  handleAudioPlayed(id: string, error?: string): void {
    const chunk = this.realtimeAudioDurations.get(id);
    if (chunk) {
      this.realtimeAudioDurations.delete(id);
      if (!error) this.realtime?.acknowledgeAudio(chunk.responseId, chunk.duration);
      return;
    }
    this.ttsManager.confirmAudioPlayed(id, error);
  }

  /**
   * Mark speech detection start and stop only active playback.
   */
  private async handleVoiceSpeechStart(): Promise<void> {
    if (this.speechInProgress) {
      return;
    }

    const chunkReceivedAt = Date.now();
    const phaseBeforeAbort = this.processingPhase;

    this.speechInProgress = true;
    this.sessionLogger.debug("Voice speech detected – aborting playback");

    if (this.pendingAudioSegments.length > 0) {
      this.sessionLogger.debug(
        { segmentCount: this.pendingAudioSegments.length },
        `Dropping ${this.pendingAudioSegments.length} buffered audio segment(s) due to voice speech`,
      );
      this.pendingAudioSegments = [];
    }

    if (this.audioBuffer) {
      this.sessionLogger.debug(
        { chunks: this.audioBuffer.chunks.length, pcmBytes: this.audioBuffer.totalPCMBytes },
        `Clearing partial audio buffer (${this.audioBuffer.chunks.length} chunk(s)${
          this.audioBuffer.isPCM ? `, ${this.audioBuffer.totalPCMBytes} PCM bytes` : ""
        })`,
      );
      this.audioBuffer = null;
    }

    this.clearBufferTimeout();

    await this.handleAbort();

    const latencyMs = Date.now() - chunkReceivedAt;
    this.sessionLogger.debug(
      { latencyMs, phaseBeforeAbort },
      "[Telemetry] barge_in.audio_abort_latency",
    );
  }

  /**
   * Clear speech-in-progress flag once the user turn has completed
   */
  private clearSpeechInProgress(reason: string): void {
    if (!this.speechInProgress) {
      return;
    }

    this.speechInProgress = false;
    this.sessionLogger.debug({ reason }, `Speech turn complete (${reason}) – resuming TTS`);
  }

  /**
   * Create new AbortController, aborting the previous one
   */
  private createAbortController(): AbortController {
    this.abortController.abort();
    this.abortController = new AbortController();
    this.ttsDebugStreams.clear();
    return this.abortController;
  }

  /**
   * Set the processing phase
   */
  private setPhase(phase: ProcessingPhase): void {
    this.processingPhase = phase;
    if (phase === "idle") this.onIdle?.();
    this.sessionLogger.debug({ phase }, `Phase: ${phase}`);
  }

  /**
   * Set timeout to process buffered audio segments
   */
  private setBufferTimeout(): void {
    this.clearBufferTimeout();

    this.bufferTimeout = setTimeout(async () => {
      this.sessionLogger.debug("Buffer timeout reached, processing pending segments");

      if (this.processingPhase === "transcribing") {
        this.sessionLogger.debug(
          { segmentCount: this.pendingAudioSegments.length },
          "Buffer timeout deferred because transcription is still in progress",
        );
        this.setBufferTimeout();
        return;
      }

      if (this.pendingAudioSegments.length > 0) {
        const segments = [...this.pendingAudioSegments];
        this.pendingAudioSegments = [];
        this.bufferTimeout = null;

        const combined = Buffer.concat(segments.map((s) => s.audio));
        await this.processAudio(combined, segments[0].format);
      }
    }, 10000); // 10 second timeout
  }

  /**
   * Clear buffer timeout
   */
  private clearBufferTimeout(): void {
    if (this.bufferTimeout) {
      clearTimeout(this.bufferTimeout);
      this.bufferTimeout = null;
    }
  }

  /**
   * Emit a message to the client. Captures TTS audio_output frames for optional
   * debug persistence before forwarding to the session emitter.
   */
  private emit(msg: SessionOutboundMessage): void {
    if (this.closed) return;
    if (
      msg.type === "audio_output" &&
      (process.env.TTS_DEBUG_AUDIO_DIR || isPaseoDictationDebugEnabled()) &&
      msg.payload.groupId &&
      typeof msg.payload.audio === "string"
    ) {
      const groupId = msg.payload.groupId;
      const existing =
        this.ttsDebugStreams.get(groupId) ??
        ({ format: msg.payload.format, chunks: [] } satisfies {
          format: string;
          chunks: Buffer[];
        });

      try {
        existing.chunks.push(Buffer.from(msg.payload.audio, "base64"));
        existing.format = msg.payload.format;
        this.ttsDebugStreams.set(groupId, existing);
      } catch {
        // ignore malformed base64
      }

      if (msg.payload.isLastChunk) {
        const final = this.ttsDebugStreams.get(groupId);
        this.ttsDebugStreams.delete(groupId);
        if (final && final.chunks.length > 0) {
          void (async () => {
            const recordingPath = await maybePersistTtsDebugAudio(
              Buffer.concat(final.chunks),
              { sessionId: this.sessionId, groupId, format: final.format },
              this.sessionLogger,
            );
            if (recordingPath) {
              this.host.emit({
                type: "activity_log",
                payload: {
                  id: uuidv4(),
                  timestamp: new Date(),
                  type: "system",
                  content: `Saved TTS audio: ${recordingPath}`,
                  metadata: { recordingPath, format: final.format, groupId },
                },
              });
            }
          })();
        }
      }
    }
    if (
      msg.type === "audio_output" ||
      msg.type === "transcription_result" ||
      msg.type === "voice_input_state"
    ) {
      if (!this.currentAttachment()) return;
      this.host.emit({
        ...msg,
        payload: {
          ...msg.payload,
          attachmentId: this.voiceModeAttachmentId ?? undefined,
          generation: this.voiceModeGeneration ?? undefined,
        },
      } as SessionOutboundMessage);
      return;
    }
    this.host.emit(msg);
  }

  /** Stop input synchronously, including a source disconnected during bootstrap. */
  cancel(): void {
    if (this.closed) return;
    this.closed = true;
    this.realtime?.stop();
    this.abortController.abort();
    this.clearBufferTimeout();
    this.pendingAudioSegments = [];
    this.audioBuffer = null;
    const failures: unknown[] = [];
    for (const cleanup of [
      () => this.ttsManager.cleanup(),
      () => this.sttManager.cleanup(),
      () => this.dictationStreamManager.cleanupAll(),
    ]) {
      try {
        cleanup();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw new AggregateError(failures, "Voice input cleanup failed");
  }

  /** Release audio resources after in-flight requests settle. */
  async cleanup(): Promise<void> {
    try {
      this.cancel();
    } finally {
      try {
        await this.stopVoiceTurnController();
      } finally {
        await this.disableVoiceModeForActiveAgent();
        this.isVoiceMode = false;
      }
    }
  }
}
