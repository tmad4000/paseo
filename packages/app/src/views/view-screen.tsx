import React, { useCallback, useEffect, useMemo, useState } from "react";
import * as Clipboard from "expo-clipboard";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { supportsDesktopPaneSplits, useIsCompactFormFactor } from "@/constants/layout";
import { useToast } from "@/contexts/toast-context";
import { DiffDocumentWorkspaceCacheProvider } from "@/git/diff-document/workspace-cache";
import { getHostRuntimeStore, isHostRuntimeConnected } from "@/runtime/host-runtime";
import { buildWorkspacePaneContentModel } from "@/screens/workspace/workspace-pane-content";
import {
  reconcileTabActivity,
  type TabActivityState,
} from "@/screens/workspace/workspace-tab-activity";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { useSessionStore } from "@/stores/session-store";
import { useTabReadPolicy } from "@/screens/workspace/use-tab-read-policy";
import { collectAllPanes } from "@/stores/workspace-layout-actions";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import {
  buildViewLayoutKey,
  collectViewTabs,
  isViewTabTarget,
  useViewsStore,
  type ViewTabInput,
} from "@/stores/views-store";
import { buildProviderCommand } from "@/utils/provider-command-templates";
import { WorkspaceFocusProvider } from "@/workspace/focus";
import type { WorkspaceTabScope } from "@/workspace-tabs/model";
import { ViewPaneActionsProvider, type ViewPaneActions } from "@/views/view-pane-actions";
import { ViewSessionPicker, type ViewSessionPickerRequest } from "@/views/view-session-picker";
import { ViewScreenHeader } from "@/views/view-screen-header";
import { useViewTimelineSync } from "@/views/use-view-timeline-sync";
import { collectBroadcastTargets } from "@/views/broadcast-plan";
import { ViewBroadcastModal } from "@/views/view-broadcast-modal";
import { useViewKeyboard } from "@/views/use-view-keyboard";
import { ViewPaneSurface } from "@/views/view-pane-surface";

const EMPTY_TAB_IDS = new Set<string>();

type SplitPosition = "left" | "right" | "top" | "bottom";

export function ViewScreen({ viewId }: { viewId: string }) {
  const { t } = useTranslation();
  const view = useViewsStore((state) => state.views[viewId] ?? null);
  if (!view) {
    return (
      <View style={styles.missing}>
        <Text style={styles.missingText}>{t("views.notFound")}</Text>
      </View>
    );
  }
  return <ViewScreenContent viewId={viewId} />;
}

function ViewScreenContent({ viewId }: { viewId: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const view = useViewsStore((state) => state.views[viewId]);
  const store = useViewsStore.getState;
  const layoutKey = buildViewLayoutKey(viewId);
  const [hoveredCloseTabKey, setHoveredCloseTabKey] = useState<string | null>(null);
  const [pickerRequest, setPickerRequest] = useState<ViewSessionPickerRequest | null>(null);

  const uiTabs = useMemo(() => (view ? collectViewTabs(view) : []), [view]);
  useViewTimelineSync({ ownerKey: layoutKey, layout: view?.layout ?? null, tabs: uiTabs });
  const scopeForAgent = useCallback(
    (agentId: string): WorkspaceTabScope | null =>
      uiTabs.find((tab) => tab.target.kind === "agent" && tab.target.agentId === agentId)?.scope ??
      null,
    [uiTabs],
  );

  // Unread dots: a tab is unread once its agent moved on while it was not on screen.
  const sessions = useSessionStore((state) => state.sessions);
  const activityOverrides = useSessionStore((state) => state.agentLastActivity);
  const activityByAgentId = useMemo(() => {
    const activity = new Map<string, number>();
    for (const tab of uiTabs) {
      if (tab.target.kind !== "agent" || !tab.scope) continue;
      const agentId = tab.target.agentId;
      const date =
        activityOverrides.get(agentId) ??
        sessions[tab.scope.serverId]?.agents?.get(agentId)?.lastActivityAt;
      const timestamp = date?.getTime() ?? 0;
      if (Number.isFinite(timestamp) && timestamp > 0) activity.set(agentId, timestamp);
    }
    return activity;
  }, [activityOverrides, sessions, uiTabs]);
  const descriptors = useMemo<WorkspaceTabDescriptor[]>(
    () =>
      uiTabs.map((tab) => ({
        key: tab.tabId,
        tabId: tab.tabId,
        kind: tab.target.kind,
        target: tab.target,
        scope: tab.scope,
      })),
    [uiTabs],
  );
  const viewedTabIds = useMemo(() => {
    if (!view) return EMPTY_TAB_IDS;
    return new Set(
      collectAllPanes(view.layout.root)
        .filter((pane) => !pane.hidden && pane.focusedTabId)
        .map((pane) => pane.focusedTabId as string),
    );
  }, [view]);
  const tabReadPolicy = useTabReadPolicy(descriptors, null);
  const [tabActivity, setTabActivity] = useState<Map<string, TabActivityState>>(() => new Map());
  useEffect(() => {
    setTabActivity((previous) =>
      reconcileTabActivity(previous, descriptors, activityByAgentId, viewedTabIds, tabReadPolicy),
    );
  }, [activityByAgentId, descriptors, tabReadPolicy, viewedTabIds]);
  const unreadTabIds = useMemo(
    () => new Set([...tabActivity].filter(([, state]) => state.unread).map(([tabId]) => tabId)),
    [tabActivity],
  );

  const copy = useCallback(
    async (value: string, copiedLabel: string) => {
      try {
        await Clipboard.setStringAsync(value);
        toast.copied(copiedLabel);
      } catch {
        toast.error(t("workspace.tabs.toasts.copyFailed"));
      }
    },
    [t, toast],
  );

  const handleCopyResumeCommand = useCallback(
    async (agentId: string) => {
      const scope = scopeForAgent(agentId);
      const agent = scope
        ? (useSessionStore.getState().sessions[scope.serverId]?.agents?.get(agentId) ?? null)
        : null;
      const providerSessionId =
        agent?.runtimeInfo?.sessionId ?? agent?.persistence?.sessionId ?? null;
      if (!agent || !providerSessionId) {
        toast.error(t("workspace.tabs.toasts.resumeIdUnavailable"));
        return;
      }
      const command = buildProviderCommand({
        provider: agent.provider,
        id: "resume",
        sessionId: providerSessionId,
      });
      if (!command) {
        toast.error(t("workspace.tabs.toasts.resumeCommandUnavailable"));
        return;
      }
      await copy(command, t("workspace.tabs.toasts.resumeCommandCopiedLabel"));
    },
    [copy, scopeForAgent, t, toast],
  );

  const handleReloadAgent = useCallback(
    async (agentId: string) => {
      const scope = scopeForAgent(agentId);
      const runtime = getHostRuntimeStore();
      const client = scope ? runtime.getClient(scope.serverId) : null;
      if (!scope || !client || !isHostRuntimeConnected(runtime.getSnapshot(scope.serverId))) {
        toast.error(t("workspace.terminal.hostDisconnected"));
        return;
      }
      toast.show(t("workspace.tabs.toasts.reloadingAgent"), { durationMs: null });
      try {
        await client.refreshAgent(agentId);
        const cursor = useSessionStore
          .getState()
          .sessions[scope.serverId]?.agentTimelineCursor.get(agentId);
        await runtime.fetchAgentTimeline(scope.serverId, agentId, {
          direction: "tail",
          projection: "projected",
          ...(cursor ? { cursor: { epoch: cursor.epoch, seq: cursor.endSeq } } : {}),
        });
        toast.show(t("workspace.tabs.toasts.reloadedAgent"), { variant: "success" });
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : t("workspace.tabs.toasts.failedToReloadAgent"),
        );
      }
    },
    [scopeForAgent, t, toast],
  );

  /** Anything that is not a session opens in its home workspace, where it has context. */
  const openInHomeWorkspace = useCallback(
    (scope: WorkspaceTabScope, target: WorkspaceTabDescriptor["target"]) => {
      navigateToWorkspace({ serverId: scope.serverId, workspaceId: scope.workspaceId, target });
    },
    [],
  );

  const closeTabs = useCallback(
    (tabIds: string[]) => {
      for (const tabId of tabIds) store().closeTab(viewId, tabId);
    },
    [store, viewId],
  );

  const buildPaneContentModel = useCallback(
    (input: { paneId: string; tab: WorkspaceTabDescriptor }) => {
      const scope = input.tab.scope ?? { serverId: "", workspaceId: "" };
      return buildWorkspacePaneContentModel({
        tab: input.tab,
        normalizedServerId: scope.serverId,
        normalizedWorkspaceId: scope.workspaceId,
        host: "main",
        onOpenTab: (target) => {
          if (isViewTabTarget(target)) {
            store().openTab(viewId, { scope, target, paneId: input.paneId });
            return;
          }
          openInHomeWorkspace(scope, target);
        },
        onOpenPreferredTarget: (target) => {
          if (isViewTabTarget(target)) {
            store().openTab(viewId, { scope, target, paneId: input.paneId });
            return;
          }
          openInHomeWorkspace(scope, target);
        },
        onCloseCurrentTab: () => store().closeTab(viewId, input.tab.tabId),
        onRetargetCurrentTab: (target) => {
          if (!isViewTabTarget(target)) {
            openInHomeWorkspace(scope, target);
            return;
          }
          store().closeTab(viewId, input.tab.tabId);
          store().openTab(viewId, { scope, target, paneId: input.paneId });
        },
        onSetCurrentTabState: () => {},
        onOpenWorkspaceFile: (request) => {
          openInHomeWorkspace(scope, { kind: "file", ...request.location });
        },
        onOpenImportSheet: () => {},
      });
    },
    [openInHomeWorkspace, store, viewId],
  );

  const focusedPaneId = view?.layout.focusedPaneId ?? null;
  // Phones and native show one pane at a time; the header pages between them.
  const isCompact = useIsCompactFormFactor();
  const usesPager = isCompact || !supportsDesktopPaneSplits();
  const panes = useMemo(
    () => (view ? collectAllPanes(view.layout.root).filter((pane) => !pane.hidden) : []),
    [view],
  );
  const focusedPaneIndex = Math.max(
    0,
    panes.findIndex((pane) => pane.id === focusedPaneId),
  );
  const displayedLayout = useMemo(() => {
    if (!view || !usesPager || panes.length < 2) return view?.layout ?? null;
    const pane = panes[focusedPaneIndex];
    return pane ? { ...view.layout, root: { kind: "pane" as const, pane } } : view.layout;
  }, [focusedPaneIndex, panes, usesPager, view]);
  const handleShowPane = useCallback(
    (offset: number) => {
      const next = panes[(focusedPaneIndex + offset + panes.length) % panes.length];
      if (next) store().focusPane(viewId, next.id);
    },
    [focusedPaneIndex, panes, store, viewId],
  );
  const pager = useMemo(
    () =>
      usesPager && panes.length > 1
        ? { index: focusedPaneIndex, count: panes.length, onShow: handleShowPane }
        : null,
    [focusedPaneIndex, handleShowPane, panes.length, usesPager],
  );
  const openPickerForPane = useCallback(
    (paneId: string | null) => setPickerRequest({ mode: "pane", paneId }),
    [],
  );
  const renderEmptyPane = useCallback(
    (paneId: string) => <ViewEmptyPane paneId={paneId} onAdd={openPickerForPane} />,
    [openPickerForPane],
  );
  const paneActions = useMemo<ViewPaneActions>(
    () => ({
      addTabLabel: t("views.addSession"),
      onAddTab: openPickerForPane,
      renderEmptyPane,
    }),
    [openPickerForPane, renderEmptyPane, t],
  );

  const broadcastTargets = useMemo(() => collectBroadcastTargets(uiTabs), [uiTabs]);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const openBroadcast = useCallback(() => setBroadcastOpen(true), []);
  const closeBroadcast = useCallback(() => setBroadcastOpen(false), []);
  const focusedScope = useMemo(() => {
    const pane = panes.find((candidate) => candidate.id === focusedPaneId) ?? panes[0];
    const tabId = pane?.focusedTabId;
    return (tabId && uiTabs.find((tab) => tab.tabId === tabId)?.scope) || null;
  }, [focusedPaneId, panes, uiTabs]);
  const splitWithSessionAt = useCallback(
    (position: "right" | "bottom", paneId: string) =>
      setPickerRequest({ mode: "split", paneId, position }),
    [],
  );
  useViewKeyboard({ viewId, onSplitWithSession: splitWithSessionAt });
  const handleSplitWithSession = useCallback(
    () => setPickerRequest({ mode: "split", paneId: focusedPaneId }),
    [focusedPaneId],
  );
  const renderMainHeader = useCallback(
    () => (
      <ViewScreenHeader
        viewId={viewId}
        pager={pager}
        focusedScope={focusedScope}
        broadcastTargetCount={broadcastTargets.length}
        onBroadcast={openBroadcast}
        onSplitWithSession={handleSplitWithSession}
      />
    ),
    [broadcastTargets.length, focusedScope, handleSplitWithSession, openBroadcast, pager, viewId],
  );
  const handleExitFocusMode = useCallback(() => {}, []);
  const handleNavigateTab = useCallback(
    (tabId: string) => store().focusTab(viewId, tabId),
    [store, viewId],
  );
  const handleCloseTab = useCallback(
    (tabId: string) => store().closeTab(viewId, tabId),
    [store, viewId],
  );
  const handleCopyAgentId = useCallback(
    (agentId: string) => copy(agentId, t("workspace.tabs.toasts.agentIdCopiedLabel")),
    [copy, t],
  );
  const handleCopyTerminalId = useCallback(
    (terminalId: string) => copy(terminalId, t("workspace.tabs.toasts.terminalIdCopiedLabel")),
    [copy, t],
  );
  const handleCopyFilePath = useCallback(
    (path: string) => copy(path, t("workspace.tabs.toasts.filePathCopiedLabel")),
    [copy, t],
  );
  const handleRenameTab = useCallback(() => {}, []);
  const handleCloseTabsToLeft = useCallback(
    (tabId: string, paneTabs: WorkspaceTabDescriptor[]) => {
      const index = paneTabs.findIndex((tab) => tab.tabId === tabId);
      closeTabs(paneTabs.slice(0, Math.max(index, 0)).map((tab) => tab.tabId));
    },
    [closeTabs],
  );
  const handleCloseTabsToRight = useCallback(
    (tabId: string, paneTabs: WorkspaceTabDescriptor[]) => {
      const index = paneTabs.findIndex((tab) => tab.tabId === tabId);
      closeTabs(index < 0 ? [] : paneTabs.slice(index + 1).map((tab) => tab.tabId));
    },
    [closeTabs],
  );
  const handleCloseOtherTabs = useCallback(
    (tabId: string, paneTabs: WorkspaceTabDescriptor[]) =>
      closeTabs(paneTabs.filter((tab) => tab.tabId !== tabId).map((tab) => tab.tabId)),
    [closeTabs],
  );
  const handleCreateNewTab = useCallback(
    (input: { paneId?: string }) => openPickerForPane(input.paneId ?? focusedPaneId),
    [focusedPaneId, openPickerForPane],
  );
  const handleFocusPane = useCallback(
    (paneId: string) => store().focusPane(viewId, paneId),
    [store, viewId],
  );
  const handleSplitPane = useCallback(
    (input: { tabId: string; targetPaneId: string; position: SplitPosition }) => {
      store().splitPane(viewId, input);
    },
    [store, viewId],
  );
  const handleSplitPaneEmpty = useCallback(
    (input: { targetPaneId: string; position: SplitPosition }) => {
      store().splitPaneEmpty(viewId, input);
    },
    [store, viewId],
  );
  const handleMoveTabToPane = useCallback(
    (tabId: string, toPaneId: string) => store().moveTabToPane(viewId, tabId, toPaneId),
    [store, viewId],
  );
  const handleSelectTabInPane = useCallback(
    (paneId: string, tabId: string) => store().selectTabInPane(viewId, paneId, tabId),
    [store, viewId],
  );
  const handleResizeSplit = useCallback(
    (groupId: string, sizes: number[]) => store().resizeSplit(viewId, groupId, sizes),
    [store, viewId],
  );
  const handleReorderTabsInPane = useCallback(
    (paneId: string, tabIds: string[]) => store().reorderTabsInPane(viewId, paneId, tabIds),
    [store, viewId],
  );
  const handleClosePicker = useCallback(() => setPickerRequest(null), []);
  const handlePick = useCallback(
    (input: ViewTabInput) => {
      const request = pickerRequest;
      setPickerRequest(null);
      if (!request) return;
      if (request.mode === "split") {
        store().openTabInNewSplit(viewId, {
          ...input,
          targetPaneId: request.paneId,
          position: request.position ?? "right",
        });
        return;
      }
      store().openTab(viewId, { ...input, paneId: request.paneId });
    },
    [pickerRequest, store, viewId],
  );

  if (!view || !displayedLayout) return null;

  return (
    <WorkspaceFocusProvider workspaceKey={null}>
      <DiffDocumentWorkspaceCacheProvider>
        <ViewPaneActionsProvider value={paneActions}>
          <View style={styles.container} testID="view-screen">
            <ViewPaneSurface
              layout={displayedLayout}
              renderEmptyPane={renderEmptyPane}
              renderMainHeader={renderMainHeader}
              onExitFocusMode={handleExitFocusMode}
              workspaceKey={layoutKey}
              normalizedServerId=""
              normalizedWorkspaceId=""
              isWorkspaceFocused
              uiTabs={uiTabs}
              activityByAgentId={activityByAgentId}
              unreadTabIds={unreadTabIds}
              hoveredCloseTabKey={hoveredCloseTabKey}
              setHoveredCloseTabKey={setHoveredCloseTabKey}
              closingTabIds={EMPTY_TAB_IDS}
              onNavigateTab={handleNavigateTab}
              onCloseTab={handleCloseTab}
              onCopyResumeCommand={handleCopyResumeCommand}
              onCopyAgentId={handleCopyAgentId}
              onCopyTerminalId={handleCopyTerminalId}
              onCopyFilePath={handleCopyFilePath}
              onReloadAgent={handleReloadAgent}
              onRenameTab={handleRenameTab}
              onCloseTabsToLeft={handleCloseTabsToLeft}
              onCloseTabsToRight={handleCloseTabsToRight}
              onCloseOtherTabs={handleCloseOtherTabs}
              onCreateNewTab={handleCreateNewTab}
              buildPaneContentModel={buildPaneContentModel}
              onFocusPane={handleFocusPane}
              onSplitPane={handleSplitPane}
              onSplitPaneEmpty={handleSplitPaneEmpty}
              onMoveTabToPane={handleMoveTabToPane}
              onSelectTabInPane={handleSelectTabInPane}
              onResizeSplit={handleResizeSplit}
              onReorderTabsInPane={handleReorderTabsInPane}
            />
          </View>
          <ViewBroadcastModal
            visible={broadcastOpen}
            targets={broadcastTargets}
            onClose={closeBroadcast}
          />
          <ViewSessionPicker
            request={pickerRequest}
            onClose={handleClosePicker}
            onPick={handlePick}
          />
        </ViewPaneActionsProvider>
      </DiffDocumentWorkspaceCacheProvider>
    </WorkspaceFocusProvider>
  );
}

function emptyButtonStyle({ hovered }: { hovered?: boolean }) {
  return [styles.emptyButton, hovered ? styles.emptyButtonHover : null];
}

function ViewEmptyPane({ paneId, onAdd }: { paneId: string; onAdd: (paneId: string) => void }) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => onAdd(paneId), [onAdd, paneId]);
  return (
    <View style={styles.emptyPane}>
      <Text style={styles.emptyTitle}>{t("views.emptyPane.title")}</Text>
      <Pressable
        accessibilityRole="button"
        testID="view-empty-pane-add"
        onPress={handlePress}
        style={emptyButtonStyle}
      >
        <Text style={styles.emptyButtonText}>{t("views.addSession")}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  missing: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface0,
  },
  missingText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  emptyPane: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[4],
  },
  emptyTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  emptyButton: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  emptyButtonHover: {
    backgroundColor: theme.colors.surface2,
  },
  emptyButtonText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
