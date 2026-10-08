import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { shallow } from "zustand/shallow";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { StyleSheet } from "react-native-unistyles";
import { Pin } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { useHosts } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { selectPinnedSessions, sessionPinKey, type PinnableSession } from "./model";

export function PinnedSessions({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  const hosts = useHosts();
  const maps = useStoreWithEqualityFn(
    useSessionStore,
    (state) => hosts.map((host) => state.sessions[host.serverId]?.agents),
    shallow,
  );
  const sessions = useMemo(
    () => selectPinnedSessions(maps.flatMap((map) => [...(map?.values() ?? [])])),
    [maps],
  );
  if (!sessions.length) return null;
  return (
    <View style={styles.section} testID="sidebar-pinned-sessions">
      <Text style={styles.heading}>{t("sessionPins.title", "Pinned sessions")}</Text>
      {sessions.map((session) => (
        <PinnedSessionRow
          key={sessionPinKey(session)}
          session={session}
          hostLabel={
            hosts.find((host) => host.serverId === session.serverId)?.label || session.serverId
          }
          showHost={hosts.length > 1}
          onNavigate={onNavigate}
        />
      ))}
    </View>
  );
}

function PinnedSessionRow({
  session,
  hostLabel,
  showHost,
  onNavigate,
}: {
  session: PinnableSession;
  hostLabel: string;
  showHost: boolean;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => {
    navigateToAgent({ serverId: session.serverId, agentId: session.id });
    onNavigate?.();
  }, [session.serverId, session.id, onNavigate]);
  const title = session.title || session.id;
  return (
    <Button
      variant="ghost"
      size="md"
      leftIcon={Pin}
      style={styles.row}
      textStyle={styles.title}
      accessibilityLabel={t("sessionPins.open", { title, host: hostLabel })}
      onPress={handlePress}
    >
      {showHost ? `${title} · ${hostLabel}` : title}
    </Button>
  );
}

const styles = StyleSheet.create((theme) => ({
  section: { paddingHorizontal: theme.spacing[2], paddingBottom: theme.spacing[2] },
  heading: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    padding: theme.spacing[2],
  },
  row: { justifyContent: "flex-start", minHeight: 44 },
  title: { flexShrink: 1, textAlign: "left" },
}));
