import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Mic, MicOff, PhoneOff, Square } from "lucide-react-native";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { FOOTER_HEIGHT } from "@/constants/layout";
import { useVoiceTelemetry } from "@/contexts/voice-context";
import type { Theme } from "@/styles/theme";
import { isVoiceFailureBlocking, type VoiceFailureKind } from "@/voice/voice-failure";
import { VolumeMeter } from "./volume-meter";

interface RealtimeVoiceOverlayProps {
  isMuted: boolean;
  isSwitching: boolean;
  voiceCommandsEnabled: boolean;
  isMuteSwitching: boolean;
  muteError: string | null;
  failure: VoiceFailureKind | null;
  lastInputStatus?: "queued" | "sent" | "removed" | "unknown" | null;
  isAgentRunning?: boolean;
  isCancellingAgent?: boolean;
  onToggleMute: () => void;
  onStop: () => void;
  onCancelAgent?: () => void;
}

const ThemedMic = withUnistyles(Mic);
const ThemedMicOff = withUnistyles(MicOff);
const ThemedPhoneOff = withUnistyles(PhoneOff);
const ThemedSquare = withUnistyles(Square);
const ThemedSpinner = withUnistyles(LoadingSpinner);
const whiteIconProps = (theme: Theme) => ({
  size: theme.iconSize.lg,
  color: theme.colors.palette.white,
});
const foregroundIconProps = (theme: Theme) => ({
  size: theme.iconSize.lg,
  color: theme.colors.foreground,
});
const squareProps = (theme: Theme) => ({
  ...whiteIconProps(theme),
  fill: theme.colors.palette.white,
});
const spinnerProps = (theme: Theme) => ({ color: theme.colors.palette.white });

const OVERLAY_BUTTON_SIZE = 44;
const OVERLAY_VERTICAL_PADDING = (FOOTER_HEIGHT - OVERLAY_BUTTON_SIZE) / 2;
const inputStatusLabels = {
  queued: { key: "realtimeVoice.inputQueued", defaultValue: "Speech queued for agent" },
  sent: { key: "realtimeVoice.inputSent", defaultValue: "Speech sent to agent" },
  removed: { key: "realtimeVoice.inputRemoved", defaultValue: "Speech removed from queue" },
  unknown: { key: "realtimeVoice.inputUnknown", defaultValue: "Speech delivery uncertain" },
} as const;

export function RealtimeVoiceOverlay({
  isMuted,
  isSwitching,
  voiceCommandsEnabled,
  isMuteSwitching,
  muteError,
  failure,
  lastInputStatus,
  isAgentRunning,
  isCancellingAgent,
  onToggleMute,
  onStop,
  onCancelAgent,
}: RealtimeVoiceOverlayProps) {
  const { t } = useTranslation();
  const { volume, isSpeaking } = useVoiceTelemetry();
  const muteButtonStyle = useMemo(
    () => [
      styles.actionButton,
      styles.muteButton,
      isMuted ? styles.muteButtonMuted : undefined,
      isSwitching || isMuteSwitching ? styles.buttonDisabled : undefined,
    ],
    [isMuted, isSwitching, isMuteSwitching],
  );
  const muteAccessibilityState = useMemo(
    () => ({
      disabled: isSwitching || isMuteSwitching,
      busy: isMuteSwitching,
      selected: isMuted,
    }),
    [isSwitching, isMuteSwitching, isMuted],
  );
  const stopButtonStyle = useMemo(
    () => [styles.actionButton, styles.stopButton, isSwitching ? styles.buttonDisabled : undefined],
    [isSwitching],
  );
  const notListening = failure !== null && isVoiceFailureBlocking(failure);
  let statusLabel = t("realtimeVoice.listening");
  if (notListening) statusLabel = t("realtimeVoice.notListening");
  else if (isMuted) statusLabel = t("realtimeVoice.muted");
  return (
    <View style={styles.panel}>
      <View accessibilityLiveRegion="polite" style={styles.status}>
        <Text style={isMuted || notListening ? styles.mutedLabel : styles.label}>
          {statusLabel}
        </Text>
        {!notListening && (
          <Text style={styles.hint}>
            {voiceCommandsEnabled
              ? t(isMuted ? "realtimeVoice.mutedHint" : "realtimeVoice.commandHint")
              : t("realtimeVoice.commandsUnavailable")}
          </Text>
        )}
        {failure && (
          <Text accessibilityRole="alert" style={styles.error}>
            {t(`realtimeVoice.failure.${failure}`)}
          </Text>
        )}
        {muteError && (
          <Text accessibilityRole="alert" style={styles.error}>
            {muteError}
          </Text>
        )}
        {lastInputStatus && (
          <Text accessibilityLiveRegion="polite" style={styles.hint}>
            {t(inputStatusLabels[lastInputStatus].key, {
              defaultValue: inputStatusLabels[lastInputStatus].defaultValue,
            })}
          </Text>
        )}
      </View>
      <View style={styles.container}>
        <View style={styles.meterContainer}>
          <VolumeMeter
            volume={volume}
            isMuted={isMuted}
            isSpeaking={isSpeaking}
            orientation="horizontal"
          />
        </View>

        <View style={styles.actionsContainer}>
          {isAgentRunning && onCancelAgent && (
            <Pressable
              onPress={onCancelAgent}
              disabled={isCancellingAgent}
              accessibilityRole="button"
              accessibilityLabel={t("realtimeVoice.actions.interruptAgent", {
                defaultValue: "Interrupt agent",
              })}
              style={stopButtonStyle}
            >
              {isCancellingAgent ? (
                <ThemedSpinner size="small" uniProps={spinnerProps} />
              ) : (
                <ThemedSquare uniProps={squareProps} strokeWidth={2.5} />
              )}
            </Pressable>
          )}

          <Pressable
            onPress={onToggleMute}
            disabled={isSwitching || isMuteSwitching}
            accessibilityState={muteAccessibilityState}
            accessibilityRole="button"
            accessibilityLabel={
              isMuted ? t("realtimeVoice.actions.unmute") : t("realtimeVoice.actions.mute")
            }
            style={muteButtonStyle}
          >
            {isMuted ? (
              <ThemedMicOff uniProps={whiteIconProps} strokeWidth={2.5} />
            ) : (
              <ThemedMic uniProps={foregroundIconProps} strokeWidth={2.5} />
            )}
          </Pressable>

          <Pressable
            onPress={onStop}
            disabled={isSwitching}
            accessibilityRole="button"
            accessibilityLabel={t("realtimeVoice.actions.stop")}
            style={stopButtonStyle}
          >
            {isSwitching ? (
              <ThemedSpinner size="small" uniProps={spinnerProps} />
            ) : (
              <ThemedPhoneOff uniProps={whiteIconProps} strokeWidth={2.5} />
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  panel: {
    width: "100%",
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius["2xl"],
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  status: {
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[2],
    gap: theme.spacing[1],
  },
  label: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  mutedLabel: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.sm },
  container: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    height: FOOTER_HEIGHT,
    borderRadius: theme.borderRadius["2xl"],
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: OVERLAY_VERTICAL_PADDING,
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  meterContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  actionsContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  actionButton: {
    width: OVERLAY_BUTTON_SIZE,
    height: OVERLAY_BUTTON_SIZE,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  muteButton: {
    backgroundColor: theme.colors.surface0,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  muteButtonMuted: {
    backgroundColor: theme.colors.palette.red[600],
    borderColor: theme.colors.palette.red[800],
  },
  stopButton: {
    backgroundColor: theme.colors.palette.red[600],
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.palette.red[800],
  },
  buttonDisabled: {
    opacity: 0.5,
  },
}));
