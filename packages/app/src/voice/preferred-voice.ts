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

export interface StartPreferredVoiceForNewAgentInput extends Omit<
  StartPreferredVoiceInput,
  "agentId"
> {
  /** Creates the chat's agent; resolves to its id, or null when none was created. */
  createAgent: () => Promise<string | null>;
}

/**
 * Voice attaches to an agent, and a brand-new chat has none until its first
 * message. Pressing voice there creates the agent first (no prompt, so no turn
 * starts) and then starts voice on it, so a new chat can begin by talking.
 */
export async function startPreferredVoiceForNewAgent(
  input: StartPreferredVoiceForNewAgentInput,
): Promise<(PreferredVoiceResult & { agentId: string }) | null> {
  const agentId = await input.createAgent();
  if (!agentId) return null;
  const result = await startPreferredVoice({
    startVoice: input.startVoice,
    serverId: input.serverId,
    agentId,
    preferRealtimeGpt: input.preferRealtimeGpt,
  });
  return { ...result, agentId };
}

/**
 * A draft chat offers voice only while its composer is empty and idle: the
 * voice start creates the agent with no prompt, so typed content keeps the
 * normal send path instead of being dropped.
 */
export function resolveCanCreateAgentForVoice(input: {
  hasAgent: boolean;
  canCreateAgent: boolean;
  isSubmitLoading: boolean;
  hasSendableContent: boolean;
}): boolean {
  return (
    !input.hasAgent && input.canCreateAgent && !input.isSubmitLoading && !input.hasSendableContent
  );
}
