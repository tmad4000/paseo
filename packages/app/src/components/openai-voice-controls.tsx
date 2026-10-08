import { useCallback, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { RealtimeVoiceState } from "@getpaseo/protocol/messages";
import { Button } from "@/components/ui/button";
import { useVoiceOptional } from "@/contexts/voice-context";
import { useSessionStore } from "@/stores/session-store";

type ControlAction =
  | "listen"
  | "end_listening"
  | "clear"
  | "retry"
  | "focus_agent"
  | "back_to_assistant";
interface ActionProps {
  name: ControlAction;
  label: string;
  disabled: boolean;
  run(action: ControlAction): void;
}
function ControlActionButton({ name, label, disabled, run }: ActionProps) {
  const press = useCallback(() => run(name), [name, run]);
  return (
    <Button variant="outline" disabled={disabled} onPress={press}>
      {label}
    </Button>
  );
}
function ConnectedControls({
  state,
  disabled,
  control,
}: {
  state: RealtimeVoiceState;
  disabled: boolean;
  control: (action: ControlAction) => void;
}) {
  const listening = state.mode === "listen";
  return (
    <>
      <Text style={styles.hint}>
        {listening
          ? "Listening until you finish. Silence never sends. Say end listening; prefix literal to dictate that phrase."
          : "Conversation · work stays with your existing agent"}
      </Text>
      <Text style={styles.hint}>
        {state.destination === "agent"
          ? "Direct focus: your finalized words go to the displayed agent queue"
          : "Assistant: GPT handles conversation and forwards work requests to the displayed agent"}
      </Text>
      {state.draft ? (
        <ScrollView style={styles.draft}>
          <Text selectable style={styles.label}>
            {state.draft}
          </Text>
        </ScrollView>
      ) : null}
      {state.omittedContextEntries > 0 ? (
        <Text style={styles.hint}>
          Recent context restored; {state.omittedContextEntries} older entries remain in host
          history.
        </Text>
      ) : null}
      <View style={styles.actions}>
        <ControlActionButton
          name={listening ? "end_listening" : "listen"}
          label={listening ? "End listening" : "Listen until I finish"}
          disabled={disabled}
          run={control}
        />
        <ControlActionButton
          name={state.destination === "agent" ? "back_to_assistant" : "focus_agent"}
          label={state.destination === "agent" ? "Back to assistant" : "Focus agent directly"}
          disabled={disabled}
          run={control}
        />
        <ControlActionButton
          name="clear"
          label="Clear voice context"
          disabled={disabled}
          run={control}
        />
        {state.connection === "unavailable" ? (
          <ControlActionButton
            name="retry"
            label="Retry, microphone off"
            disabled={disabled}
            run={control}
          />
        ) : null}
      </View>
      <Text style={styles.hint}>
        Clear starts fresh for voice. Previous conversation and unsent spoken draft stay in host
        history. Agent messages, memory and work remain unchanged.
      </Text>
    </>
  );
}

/** Optional voice has no agent create, cancel, reload or navigation operations. */
export function OpenAiVoiceControls({
  serverId,
  agentId,
  readOnly,
}: {
  serverId?: string;
  agentId?: string;
  readOnly: boolean;
}) {
  const voice = useVoiceOptional();
  const session = useSessionStore((state) => (serverId ? state.sessions[serverId] : undefined));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const active = Boolean(serverId && agentId && voice?.isVoiceModeForAgent(serverId, agentId));
  const realtime = active ? voice?.realtime : undefined;
  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Voice unavailable");
    } finally {
      setBusy(false);
    }
  }, []);
  const control = useCallback(
    (action: ControlAction) => {
      if (voice) void run(() => voice.controlRealtime(action));
    },
    [voice, run],
  );
  const start = useCallback(() => {
    if (!voice || !serverId || !agentId) return;
    void run(async () => {
      if (active) await voice.stopVoice();
      await voice.startVoice(serverId, agentId, "openai-realtime");
    });
  }, [voice, serverId, agentId, active, run]);
  const fallback = useCallback(() => {
    if (!voice || !serverId || !agentId) return;
    void run(async () => {
      await voice.stopVoice();
      await voice.startVoice(serverId, agentId, "paseo", true);
    });
  }, [voice, serverId, agentId, run]);
  const stop = useCallback(() => {
    if (voice) void run(voice.stopVoice);
  }, [voice, run]);
  if (readOnly || !voice || !session?.serverInfo?.features?.openaiRealtimeVoice || !agentId)
    return null;
  return (
    <VoiceControlPanel
      voice={voice}
      state={realtime}
      target={session.agents.get(agentId)?.title || agentId}
      active={active}
      busy={busy}
      error={error}
      start={start}
      stop={stop}
      fallback={fallback}
      control={control}
    />
  );
}
function VoiceControlPanel({
  voice,
  state,
  target,
  active,
  busy,
  error,
  start,
  stop,
  fallback,
  control,
}: {
  voice: NonNullable<ReturnType<typeof useVoiceOptional>>;
  state: RealtimeVoiceState | undefined;
  target: string;
  active: boolean;
  busy: boolean;
  error: string | null;
  start(): void;
  stop(): void;
  fallback(): void;
  control(action: ControlAction): void;
}) {
  const disabled = busy || voice.isVoiceSwitching;
  return (
    <View style={styles.panel}>
      <Text style={styles.label} accessibilityLiveRegion="polite">
        {state ? `GPT Realtime · ${state.connection}` : "Optional GPT voice"}
      </Text>
      <Text style={styles.hint}>Target: {target} · agent work continues with voice off</Text>
      {state ? (
        <>
          <Text style={styles.hint}>
            {voice.isMuted
              ? "Microphone off · use Unmute or OS voice control; voice unmute is unavailable"
              : "Microphone on · audio sent through your host to OpenAI"}
          </Text>
          <ConnectedControls state={state} disabled={disabled} control={control} />
          <View style={styles.actions}>
            <Button
              variant="outline"
              disabled={disabled || state.connection !== "connected"}
              onPress={voice.toggleMute}
            >
              {voice.isMuted ? "Unmute microphone" : "Microphone off"}
            </Button>
            <Button variant="outline" disabled={disabled} onPress={stop}>
              End voice
            </Button>
            <Button variant="ghost" disabled={disabled} onPress={fallback}>
              Use Paseo voice, muted
            </Button>
          </View>
          <Text style={styles.hint}>
            Paseo fallback uses configured host speech providers. Its voice-resume mute can keep
            host recognition active; GPT microphone-off never does.
          </Text>
        </>
      ) : (
        <>
          <Text style={styles.hint}>
            OpenAI cloud audio · resumes saved voice context · existing Paseo voice remains
            available
          </Text>
          <Button
            variant="outline"
            disabled={disabled || Boolean(voice.isVoiceMode && !active)}
            onPress={start}
          >
            Start GPT voice
          </Button>
          {voice.isVoiceMode && !active ? (
            <Text style={styles.hint}>
              Voice remains attached to {voice.activeAgentId}. End that attachment before switching
              targets.
            </Text>
          ) : null}
        </>
      )}
      {error || voice.muteError || state?.error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error || voice.muteError || state?.error}
        </Text>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  panel: {
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
  },
  label: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  hint: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  draft: { maxHeight: 160 },
  error: { fontSize: theme.fontSize.sm, color: theme.colors.destructive },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
}));
