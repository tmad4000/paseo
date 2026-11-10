import { memo, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";
import { useHosts } from "@/runtime/host-runtime";
import {
  WorkspaceTabIcon,
  WorkspaceTabPresentationResolver,
  type WorkspaceTabPresentation,
} from "@/screens/workspace/workspace-tab-presentation";
import {
  navigateToWorkspace,
  useActiveWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import { findPaneById, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { getSidebarRowBackdrop } from "./sidebar-row-backdrop";
import { sidebarTabMeta, type SidebarTabRow } from "./sidebar-tabs";

/**
 * Tabs grouping's body: one flat list of open tabs, each opening its home workspace with that tab
 * focused (docs/sidebar-sorting.md#tabs-grouping). The rows come from the sidebar model, already
 * filtered and ordered.
 */
export function SidebarTabList({
  rows,
  onNavigate,
}: {
  rows: readonly SidebarTabRow[];
  onNavigate?: () => void;
}) {
  const hosts = useHosts();
  const showHost = hosts.length > 1;
  const hostLabels = useMemo(
    () => new Map(hosts.map((host) => [host.serverId, host.label || host.serverId])),
    [hosts],
  );
  const selection = useActiveWorkspaceSelection();
  const focusedTabId = useWorkspaceLayoutStore((state) => {
    if (!selection) return null;
    const layout = state.layoutByWorkspace[`${selection.serverId}:${selection.workspaceId}`];
    if (!layout) return null;
    return findPaneById(layout.root, layout.focusedPaneId)?.focusedTabId ?? null;
  });
  if (rows.length === 0) return null;
  return (
    <View style={styles.list} testID="sidebar-tab-list">
      {rows.map((row) => (
        <TabRow
          key={row.key}
          row={row}
          hostLabel={showHost ? (hostLabels.get(row.serverId) ?? row.serverId) : null}
          selected={
            selection?.serverId === row.serverId &&
            selection.workspaceId === row.workspaceId &&
            focusedTabId === row.tab.tabId
          }
          onNavigate={onNavigate}
        />
      ))}
    </View>
  );
}

const TabRow = memo(function TabRow({
  row,
  hostLabel,
  selected,
  onNavigate,
}: {
  row: SidebarTabRow;
  hostLabel: string | null;
  selected: boolean;
  onNavigate?: () => void;
}) {
  const meta = sidebarTabMeta(row, hostLabel);
  const open = useCallback(() => {
    onNavigate?.();
    navigateToWorkspace({
      serverId: row.serverId,
      workspaceId: row.workspaceId,
      target: row.tab.target,
    });
  }, [onNavigate, row.serverId, row.tab.target, row.workspaceId]);
  const renderPresentation = useCallback(
    (presentation: WorkspaceTabPresentation) => (
      <TabRowContent
        presentation={presentation}
        meta={meta}
        selected={selected}
        onPress={open}
        testID={`sidebar-tab-${row.serverId}-${row.workspaceId}-${row.tab.tabId}`}
      />
    ),
    [meta, open, row.serverId, row.tab.tabId, row.workspaceId, selected],
  );
  return (
    <WorkspaceTabPresentationResolver
      tab={row.tab}
      serverId={row.serverId}
      workspaceId={row.workspaceId}
    >
      {renderPresentation}
    </WorkspaceTabPresentationResolver>
  );
});

function TabRowContent({
  presentation,
  meta,
  selected,
  onPress,
  testID,
}: {
  presentation: WorkspaceTabPresentation;
  meta: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
}) {
  const { t } = useTranslation();
  const title =
    presentation.titleState === "loading" ? t("workspace.tabs.loading") : presentation.label;
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  const rowStyle = useCallback(
    ({ pressed, hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      selected && styles.rowSelected,
      hovered && !pressed && !selected && styles.rowHovered,
      pressed && styles.rowPressed,
    ],
    [selected],
  );
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={isWeb ? undefined : "button"}
      accessibilityLabel={t("sidebarSessions.open", { title, meta })}
      accessibilityState={accessibilityState}
      style={rowStyle}
      testID={testID}
    >
      {({ pressed, hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => (
        <>
          <View style={styles.iconSlot}>
            <WorkspaceTabIcon
              presentation={presentation}
              active={selected}
              backdrop={getSidebarRowBackdrop({
                isDragging: false,
                isPressed: pressed,
                selected,
                isHovered: hovered,
              })}
            />
          </View>
          <View style={styles.body}>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            <Text style={styles.meta} numberOfLines={1} testID={`${testID}-meta`}>
              {meta}
            </Text>
          </View>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  list: { paddingHorizontal: theme.spacing[2] },
  // Kept in step with the session row's geometry so switching modes does not shift the rail.
  row: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[2],
    marginBottom: theme.spacing[0.5],
    borderRadius: theme.borderRadius.lg,
    userSelect: "none",
  },
  rowHovered: { backgroundColor: theme.colors.surfaceSidebarHover },
  rowSelected: { backgroundColor: theme.colors.surfaceSidebarSelected },
  rowPressed: { backgroundColor: theme.colors.surface2 },
  iconSlot: {
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { flex: 1, minWidth: 0, gap: theme.spacing[0.5] },
  title: {
    lineHeight: 20,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
  meta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
