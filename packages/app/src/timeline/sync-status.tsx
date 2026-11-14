import type { Theme } from "@/styles/theme";
import type { AgentScreenReadySyncState } from "@/hooks/use-agent-screen-state-machine";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

const spinnerColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);

/** Anchored above the composer, never over navigation or in the responder chain. */
export function TimelineSyncStatus({ sync }: { sync: AgentScreenReadySyncState | null }) {
  const { t } = useTranslation();
  let state: "reconnecting" | "updating" | null = null;
  if (sync?.status === "reconnecting") state = "reconnecting";
  else if (sync?.status === "catching_up" && sync.ui === "status") state = "updating";
  if (!state) return null;
  return (
    <View style={styles.rail} pointerEvents="none">
      <View style={styles.badge} accessibilityRole="alert" testID={`agent-${state}-toast`}>
        <ThemedLoadingSpinner size={14} uniProps={spinnerColor} />
        <Text style={styles.label}>{t(`agentPanel.states.${state}`)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  rail: {
    position: "absolute",
    bottom: "100%",
    left: theme.spacing[3],
    right: theme.spacing[3],
    alignItems: "center",
    paddingBottom: theme.spacing[2],
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    backgroundColor: theme.colors.surface0,
    borderColor: theme.colors.border,
    borderWidth: theme.borderWidth[1],
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
  },
  label: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm, flexShrink: 1 },
}));
