import { useCallback, useMemo } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Folder } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";
import { OverlayLayerProvider, useGlobalWebOverlayLayer } from "@/lib/overlay-root";
import {
  closeRecentWorkspaceSwitcher,
  commitRecentWorkspaceSwitcher,
  highlightRecentWorkspace,
  useRecentWorkspaceSwitcherStore,
} from "./recent-workspace-switcher-store";
import type { RecentWorkspaceEntry } from "./recent-workspaces";

const ThemedFolder = withUnistyles(Folder, (theme) => ({ color: theme.colors.foregroundMuted }));

const MAX_VISIBLE_ENTRIES = 9;

function SwitcherRow({
  entry,
  index,
  active,
  currentLabel,
}: {
  entry: RecentWorkspaceEntry;
  index: number;
  active: boolean;
  currentLabel: string;
}) {
  const accessibilityState = useMemo(() => ({ selected: active }), [active]);
  const handleHoverIn = useCallback(() => highlightRecentWorkspace(index), [index]);
  const handlePress = useCallback(() => commitRecentWorkspaceSwitcher(index), [index]);
  return (
    <Pressable
      testID={`recent-workspace-switcher-row-${entry.key}`}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      onHoverIn={handleHoverIn}
      onPress={handlePress}
      style={[styles.row, active && styles.activeRow]}
    >
      <View style={styles.iconSlot}>
        <ThemedFolder size={16} strokeWidth={2.2} />
      </View>
      <View style={styles.textContent}>
        <Text style={styles.title} numberOfLines={1}>
          {entry.title}
        </Text>
        {entry.subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {entry.subtitle}
          </Text>
        ) : null}
      </View>
      {entry.isCurrent ? <Text style={styles.currentBadge}>{currentLabel}</Text> : null}
    </Pressable>
  );
}

/**
 * The Ctrl+Tab overlay: most recent workspaces first, highlighted row follows Tab /
 * Shift+Tab / arrows, releasing Control switches. Keys are handled by the global
 * keyboard hook so the gesture works wherever focus is.
 */
export function RecentWorkspaceSwitcher() {
  const { t } = useTranslation();
  const open = useRecentWorkspaceSwitcherStore((state) => state.open);
  const entries = useRecentWorkspaceSwitcherStore((state) => state.entries);
  const index = useRecentWorkspaceSwitcherStore((state) => state.index);
  const modalLayer = useGlobalWebOverlayLayer("modal", isWeb && open);

  // Keep the highlighted row in view without a scroll container: show a window of
  // rows around it, as macOS's switcher does with many apps.
  const windowStart = Math.min(
    Math.max(0, index - MAX_VISIBLE_ENTRIES + 1),
    Math.max(0, entries.length - MAX_VISIBLE_ENTRIES),
  );
  const visible = entries.slice(windowStart, windowStart + MAX_VISIBLE_ENTRIES);

  if (!open) {
    return null;
  }
  return (
    <OverlayLayerProvider layer={isWeb ? modalLayer : 0}>
      <Modal visible transparent animationType="none" onRequestClose={closeRecentWorkspaceSwitcher}>
        <View style={styles.overlay}>
          <Pressable
            style={styles.backdrop}
            onPress={closeRecentWorkspaceSwitcher}
            accessibilityLabel={t("common.actions.close")}
          />
          <View style={styles.panel} testID="recent-workspace-switcher">
            <Text style={styles.heading}>{t("shell.recentWorkspaces.title")}</Text>
            {visible.map((entry, offset) => (
              <SwitcherRow
                key={entry.key}
                entry={entry}
                index={windowStart + offset}
                active={windowStart + offset === index}
                currentLabel={t("shell.recentWorkspaces.current")}
              />
            ))}
            <Text style={styles.hint}>{t("shell.recentWorkspaces.hint")}</Text>
          </View>
        </View>
      </Modal>
    </OverlayLayerProvider>
  );
}

const styles = StyleSheet.create((theme) => ({
  overlay: {
    flex: 1,
    justifyContent: "flex-start",
    alignItems: "center",
    paddingTop: theme.spacing[12],
  },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0, 0, 0, 0.3)" },
  panel: {
    width: 480,
    maxWidth: "92%",
    paddingVertical: theme.spacing[2],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    overflow: "hidden",
    backgroundColor: theme.colors.surface0,
    ...theme.shadow.lg,
  },
  heading: {
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[2],
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  row: {
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  activeRow: { backgroundColor: theme.colors.surface1 },
  iconSlot: { width: 16, alignItems: "center", justifyContent: "center" },
  textContent: { flex: 1, minWidth: 0 },
  title: { color: theme.colors.foreground, fontSize: theme.fontSize.base, lineHeight: 18 },
  subtitle: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm, lineHeight: 16 },
  currentBadge: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  hint: {
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[2],
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
}));
