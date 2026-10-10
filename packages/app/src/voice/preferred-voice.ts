import type { VoiceRuntime } from "@/voice/voice-runtime";

export interface StartPreferredVoiceInput {
  startVoice: VoiceRuntime["startVoice"];
  serverId: string;
  agentId: string;
  /** True when the host advertises GPT realtime with a configured credential. */
  preferRealtimeGpt: boolean;
}

export interface PreferredVoiceResult {
  provider: "openai-realtime" | "paseo";
  /** Set when GPT realtime was preferred but failed and Paseo voice took over. */
  realtimeError: string | null;
}

/**
 * One voice button, one behavior: GPT realtime when the host offers it,
 * otherwise the host's own Paseo voice. A realtime start failure (missing or
 * revoked credential, connect timeout) falls back to Paseo voice instead of
 * dead-ending the button.
 */
export async function startPreferredVoice(
  input: StartPreferredVoiceInput,
): Promise<PreferredVoiceResult> {
  if (input.preferRealtimeGpt) {
    try {
      await input.startVoice(input.serverId, input.agentId, "openai-realtime", false);
      return { provider: "openai-realtime", realtimeError: null };
    } catch (error) {
      console.warn("[voice] GPT realtime start failed; falling back to Paseo voice", error);
      await input.startVoice(input.serverId, input.agentId, "paseo");
      return {
        provider: "paseo",
        realtimeError: error instanceof Error ? error.message : String(error),
      };
    }
  }
  await input.startVoice(input.serverId, input.agentId, "paseo");
  return { provider: "paseo", realtimeError: null };
}
