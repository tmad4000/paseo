import { useCallback, useMemo, useState } from "react";
import { router, type Href } from "expo-router";
import { ChevronLeft, ChevronRight, Columns2, Radio, Trash2 } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SidebarMenuToggle } from "@/components/headers/menu-header";
import {
  NavigationBackButton,
  NavigationForwardButton,
} from "@/components/headers/navigation-back-button";
import { RecentSessionsButton } from "@/components/headers/recent-sessions-button";
import { ScreenHeader } from "@/components/headers/screen-header";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import { Button } from "@/components/ui/button";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import { useViewsStore } from "@/stores/views-store";
import type { WorkspaceTabScope } from "@/workspace-tabs/model";
import { buildOpenProjectRoute } from "@/utils/host-routes";

export interface ViewPanePager {
  index: number;
  count: number;
  onShow: (offset: number) => void;
}

export function ViewScreenHeader({
  viewId,
  pager,
  focusedScope,
  broadcastTargetCount,
  onBroadcast,
  onSplitWithSession,
}: {
  viewId: string;
  pager: ViewPanePager | null;
  /** The project of the focused pane's tab; the header follows focus like iTerm's title. */
  focusedScope: WorkspaceTabScope | null;
  broadcastTargetCount: number;
  onBroadcast: () => void;
  onSplitWithSession: () => void;
}) {
  const { t } = useTranslation();
  const name = useViewsStore((state) => state.views[viewId]?.name ?? "");
  const focusedProject = useWorkspaceFields(
    focusedScope?.serverId ?? null,
    focusedScope?.workspaceId ?? null,
    (workspace) => {
      const project = workspace.projectCustomName || workspace.projectDisplayName;
      const branch = workspace.gitRuntime?.currentBranch ?? workspace.title ?? workspace.name;
      return branch ? `${project} · ${branch}` : project;
    },
  );
  const [renaming, setRenaming] = useState(false);
  const startRename = useCallback(() => setRenaming(true), []);
  const stopRename = useCallback(() => setRenaming(false), []);
  const submitRename = useCallback(
    (value: string) => useViewsStore.getState().renameView(viewId, value),
    [viewId],
  );
  const showPreviousPane = useCallback(() => pager?.onShow(-1), [pager]);
  const showNextPane = useCallback(() => pager?.onShow(1), [pager]);
  const deleteView = useCallback(() => {
    useViewsStore.getState().deleteView(viewId);
    router.replace(buildOpenProjectRoute() as Href);
  }, [viewId]);

  const left = useMemo(
    () => (
      <>
        <SidebarMenuToggle />
        <NavigationBackButton />
        <NavigationForwardButton />
        <RecentSessionsButton />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("views.actions.rename")}
          onPress={startRename}
          testID="view-header-title"
          style={styles.titleButton}
        >
          <Text numberOfLines={1} style={styles.title}>
            {name}
          </Text>
        </Pressable>
        {focusedProject ? (
          <Text numberOfLines={1} style={styles.subtitle} testID="view-header-focused-project">
            {focusedProject}
          </Text>
        ) : null}
      </>
    ),
    [focusedProject, name, startRename, t],
  );
  const right = useMemo(
    () => (
      <View style={styles.actions}>
        {pager ? (
          <View style={styles.pager} testID="view-pane-pager">
            <Button
              variant="ghost"
              size="sm"
              leftIcon={ChevronLeft}
              accessibilityLabel={t("views.actions.previousPane")}
              onPress={showPreviousPane}
              testID="view-pane-previous"
            />
            <Text style={styles.pagerLabel}>{`${pager.index + 1}/${pager.count}`}</Text>
            <Button
              variant="ghost"
              size="sm"
              leftIcon={ChevronRight}
              accessibilityLabel={t("views.actions.nextPane")}
              onPress={showNextPane}
              testID="view-pane-next"
            />
          </View>
        ) : null}
        {broadcastTargetCount > 1 ? (
          <Button
            variant="ghost"
            size="sm"
            leftIcon={Radio}
            accessibilityLabel={t("views.broadcast.title")}
            onPress={onBroadcast}
            testID="view-broadcast"
          >
            {pager ? null : t("views.broadcast.button")}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          leftIcon={Columns2}
          onPress={onSplitWithSession}
          testID="view-split-with-session"
        >
          {t("views.actions.splitWithSession")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={Trash2}
          accessibilityLabel={t("views.actions.delete")}
          onPress={deleteView}
          testID="view-delete"
        />
      </View>
    ),
    [
      broadcastTargetCount,
      deleteView,
      onBroadcast,
      onSplitWithSession,
      pager,
      showNextPane,
      showPreviousPane,
      t,
    ],
  );

  return (
    <>
      <ScreenHeader left={left} right={right} />
      <AdaptiveRenameModal
        visible={renaming}
        title={t("views.actions.rename")}
        initialValue={name}
        onClose={stopRename}
        onSubmit={submitRename}
        testID="view-rename-modal"
      />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  titleButton: {
    minWidth: 0,
    flexShrink: 1,
    paddingHorizontal: theme.spacing[1],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  subtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    flexShrink: 2,
    minWidth: 0,
  },
  pager: {
    flexDirection: "row",
    alignItems: "center",
  },
  pagerLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    minWidth: 28,
    textAlign: "center",
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
}));
