import { useCallback, useMemo, type ReactNode } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { shallow } from "zustand/shallow";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { StyleSheet } from "react-native-unistyles";
import { Pin } from "lucide-react-native";
import { PinnedSectionHeader } from "@/components/sidebar/pinned-section-header";
import { useSidebarCollapsedSectionsStore } from "@/stores/sidebar-collapsed-sections-store";
import { Button } from "@/components/ui/button";
import { useHosts } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { SidebarDragSource } from "@/workspace-tabs/sidebar-drag-source";
import { selectPinnedSessions, sessionPinKey, type PinnableSession } from "./model";

export function SidebarPinnedSection({
  hasPinnedWorkspaces,
  searchActive,
  onNavigate,
  children,
}: {
  hasPinnedWorkspaces: boolean;
  searchActive: boolean;
  onNavigate?: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const hosts = useHosts();
  const storedCollapsed = useSidebarCollapsedSectionsStore((state) => state.collapsedPinned);
  const toggleCollapsed = useSidebarCollapsedSectionsStore((state) => state.togglePinnedCollapsed);
  const collapsed = searchActive ? false : storedCollapsed;
  const maps = useStoreWithEqualityFn(
    useSessionStore,
    (state) => hosts.map((host) => state.sessions[host.serverId]?.agents),
    shallow,
  );
  const sessions = useMemo(
    () => selectPinnedSessions(maps.flatMap((map) => [...(map?.values() ?? [])])),
    [maps],
  );
  if (!hasPinnedWorkspaces && sessions.length === 0) return null;
  return (
    <View style={styles.pinnedSection} testID="sidebar-pinned-section">
      <PinnedSectionHeader collapsed={collapsed} onToggle={toggleCollapsed} />
      {collapsed ? null : (
        <>
          {hasPinnedWorkspaces ? children : null}
          {sessions.length > 0 ? (
            <View style={styles.section} testID="sidebar-pinned-sessions">
              <Text style={styles.heading}>{t("sessionPins.title", "Pinned sessions")}</Text>
              {sessions.map((session) => (
                <PinnedSessionRow
                  key={sessionPinKey(session)}
                  session={session}
                  hostLabel={
                    hosts.find((host) => host.serverId === session.serverId)?.label ||
                    session.serverId
                  }
                  showHost={hosts.length > 1}
                  onNavigate={onNavigate}
                />
              ))}
            </View>
          ) : null}
        </>
      )}
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
  const dropPayload = useMemo(
    () => ({ kind: "agent" as const, serverId: session.serverId, agentId: session.id }),
    [session.serverId, session.id],
  );
  return (
    <SidebarDragSource payload={dropPayload}>
      <Button
        testID={`sidebar-pinned-session-${session.id}`}
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
    </SidebarDragSource>
  );
}

const styles = StyleSheet.create((theme) => ({
  pinnedSection: { marginBottom: theme.spacing[1] },
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
