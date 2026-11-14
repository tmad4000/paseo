import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Columns2, Maximize2, Rows2 } from "lucide-react-native";
import { getCommandCenterIcon } from "@/command-center/icon";
import { useCommandCenterActions } from "@/command-center/provider";
import type { CommandCenterContribution, CommandCenterIcon } from "@/command-center/contributions";
import { getIsElectron } from "@/constants/platform";
import { supportsDesktopPaneSplits } from "@/constants/layout";
import { useToast } from "@/contexts/toast-context";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import { useKeyboardShortcutOverrides } from "@/hooks/use-keyboard-shortcut-overrides";
import { buildWorkspaceKeyboardHandlerId } from "@/keyboard/handler-id";
import type { KeyboardActionDefinition } from "@/keyboard/keyboard-action-dispatcher";
import { useKeyboardActionDispatcher } from "@/keyboard/keyboard-action-dispatcher-context";
import { resolveShortcutKeysForAction } from "@/keyboard/keyboard-shortcuts";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import {
  collectAllPanes,
  collectAllTabs,
  findPaneById,
  useWorkspaceLayoutStore,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-store";
import {
  compositeKey,
  selectWorkspaceTabLocalLayouts,
  useTabLocalSplitsStore,
  useTabLocalSplitsStoreHydrated,
  useWorkspaceTabLocalLayouts,
} from "@/stores/tab-local-splits-store";
import { getShortcutOs } from "@/utils/shortcut-platform";
import {
  canHostTabLocalSplit,
  dismissChooser,
  focusTabLocalLeaf,
  splitThisTab,
  toggleTabLocalZoom,
} from "@/tab-local-splits/commands";
import { findAdjacentLeaf } from "@/tab-local-splits/geometry";
import {
  buildHostByMemberTabId,
  collectLeafTabIds,
  isChooserId,
  type TabLocalLayout,
  type TabLocalSplitSide,
} from "@/tab-local-splits/model";
import {
  adoptPendingFills,
  detectTabRetargets,
  normalizeTabLocalLayouts,
  retargetTabLocalLayouts,
} from "@/tab-local-splits/normalize";

const MAX_SYNC_ROUNDS = 4;
const SPLIT_ICON = getCommandCenterIcon(Columns2);
const SPLIT_BELOW_ICON = getCommandCenterIcon(Rows2);
const ZOOM_ICON = getCommandCenterIcon(Maximize2);
const FOCUS_DIRECTIONS = {
  "workspace.pane.focus.left": "left",
  "workspace.pane.focus.right": "right",
  "workspace.pane.focus.up": "up",
  "workspace.pane.focus.down": "down",
} as const;

interface FocusedComposite {
  paneId: string;
  activeTab: { tabId: string; canHost: boolean } | null;
  layout: TabLocalLayout | null;
  zoomedLeafId: string | null;
}

/** The focused pane's active tab and, when it is a composite, its tree. */
function readFocusedComposite(workspaceKey: string): FocusedComposite | null {
  const layoutState = useWorkspaceLayoutStore.getState();
  const layout = layoutState.layoutByWorkspace[workspaceKey];
  const pane = layout ? findPaneById(layout.root, layout.focusedPaneId) : null;
  if (!layout || !pane || pane.id === layoutState.explorerSidebarPaneIdByWorkspace[workspaceKey]) {
    return null;
  }
  const tab = pane.focusedTabId
    ? collectAllTabs(layout.root).find((candidate) => candidate.tabId === pane.focusedTabId)
    : undefined;
  const store = useTabLocalSplitsStore.getState();
  const composite = tab
    ? selectWorkspaceTabLocalLayouts(store, workspaceKey)[tab.tabId]
    : undefined;
  return {
    paneId: pane.id,
    activeTab: tab ? { tabId: tab.tabId, canHost: canHostTabLocalSplit(tab.target) } : null,
    layout: composite ?? null,
    zoomedLeafId: tab
      ? (store.zoomedLeafByComposite[compositeKey(workspaceKey, tab.tabId)] ?? null)
      : null,
  };
}

/**
 * The one integration point with upstream's layout store: whenever this workspace's layout or
 * composites change, re-apply the composite invariants and write the co-location, ordering and
 * focus fixes back through the layout store's own actions. Every caller that focuses or moves a
 * tab (deep links, `ui open-tab`, tab cycling, drag and drop, pane moves) stays unaware of it.
 */
function useTabLocalSplitsSync(input: { workspaceKey: string; enabled: boolean }) {
  const { workspaceKey, enabled } = input;
  const hydrated = useTabLocalSplitsStoreHydrated();
  useEffect(() => {
    if (!enabled || !hydrated) return;
    let previousLayout: WorkspaceLayout | undefined;
    let running = false;

    function syncRound(): boolean {
      const layoutState = useWorkspaceLayoutStore.getState();
      const layout = layoutState.layoutByWorkspace[workspaceKey];
      if (!layout) return false;
      const store = useTabLocalSplitsStore.getState();
      let layouts = selectWorkspaceTabLocalLayouts(store, workspaceKey);
      if (previousLayout && previousLayout !== layout) {
        layouts = retargetTabLocalLayouts(layouts, detectTabRetargets(previousLayout, layout));
      }
      previousLayout = layout;
      const pending = store.pendingFillsByWorkspace[workspaceKey] ?? [];
      if (pending.length > 0) {
        const adopted = adoptPendingFills({ layout, layouts, pending });
        layouts = adopted.layouts;
        if (adopted.pending.length !== pending.length) {
          store.setPendingFills(workspaceKey, adopted.pending);
        }
      }
      const result = normalizeTabLocalLayouts({
        layout,
        layouts,
        explorerPaneId: layoutState.explorerSidebarPaneIdByWorkspace[workspaceKey] ?? null,
      });
      store.setLayouts(workspaceKey, result.layouts);
      for (const move of result.moves) {
        layoutState.moveTabToPane(workspaceKey, move.tabId, move.toPaneId);
      }
      for (const reorder of result.reorders) {
        layoutState.reorderTabsInPane(workspaceKey, reorder.paneId, reorder.tabIds);
      }
      for (const redirect of result.focusRedirects) {
        layoutState.selectTabInPane(workspaceKey, redirect.paneId, redirect.hostTabId);
      }
      return result.moves.length + result.reorders.length + result.focusRedirects.length > 0;
    }

    function sync() {
      // Our own writes re-enter through the subscriptions; the loop below already re-reads.
      if (running) return;
      running = true;
      try {
        for (let round = 0; round < MAX_SYNC_ROUNDS && syncRound(); round += 1);
      } finally {
        running = false;
      }
    }

    sync();
    const unsubscribeLayout = useWorkspaceLayoutStore.subscribe((state, before) => {
      if (state.layoutByWorkspace[workspaceKey] !== before.layoutByWorkspace[workspaceKey]) sync();
    });
    const unsubscribeComposites = useTabLocalSplitsStore.subscribe((state, before) => {
      if (
        state.layoutsByWorkspace[workspaceKey] !== before.layoutsByWorkspace[workspaceKey] ||
        state.pendingFillsByWorkspace[workspaceKey] !== before.pendingFillsByWorkspace[workspaceKey]
      ) {
        sync();
      }
    });
    return () => {
      unsubscribeLayout();
      unsubscribeComposites();
    };
  }, [enabled, hydrated, workspaceKey]);
}

function useRefusalToast() {
  const toast = useToast();
  const { t } = useTranslation();
  return useCallback(
    (reason: "max-depth" | "min-size") =>
      toast.error(
        t(
          reason === "min-size"
            ? "workspace.tabs.actions.tabLocal.refusedMinSize"
            : "workspace.tabs.actions.tabLocal.refusedMaxDepth",
        ),
      ),
    [t, toast],
  );
}

/** Splits the given tab, or the focused pane's tab, and reports a refusal. */
export function useSplitThisTab(workspaceKey: string) {
  const showRefusal = useRefusalToast();
  return useCallback(
    (tabId: string, side: TabLocalSplitSide) => {
      const result = splitThisTab({ workspaceKey, tabId, side });
      if (result.kind === "refused") showRefusal(result.reason);
    },
    [showRefusal, workspaceKey],
  );
}

function useTabLocalSplitsKeyboard(input: {
  workspaceKey: string;
  serverId: string;
  workspaceId: string;
  enabled: boolean;
  onCloseTab: (tabId: string) => Promise<void> | void;
}) {
  const { workspaceKey, onCloseTab } = input;
  const split = useSplitThisTab(workspaceKey);
  const handle = useCallback(
    (action: KeyboardActionDefinition): boolean => {
      const focused = readFocusedComposite(workspaceKey);
      if (!focused?.activeTab) return false;
      const { layout, activeTab } = focused;
      switch (action.id) {
        case "workspace.tab.split-local.right":
        case "workspace.tab.split-local.below":
          if (activeTab.canHost) {
            split(
              activeTab.tabId,
              action.id === "workspace.tab.split-local.right" ? "right" : "below",
            );
          }
          return true;
        case "workspace.tab.zoom-leaf":
          if (!layout) return false;
          toggleTabLocalZoom({ workspaceKey, hostTabId: layout.hostTabId });
          return true;
        case "workspace.tab.close-current": {
          if (!layout) return false;
          const leafId = layout.focusedLeafId;
          if (isChooserId(leafId)) {
            dismissChooser({ workspaceKey, hostTabId: layout.hostTabId, chooserId: leafId });
          } else {
            void onCloseTab(leafId);
          }
          return true;
        }
        case "workspace.pane.focus.left":
        case "workspace.pane.focus.right":
        case "workspace.pane.focus.up":
        case "workspace.pane.focus.down": {
          // Spatial across both scopes: the next leaf inside this tab, else upstream's pane focus.
          if (!layout || focused.zoomedLeafId) return false;
          const next = findAdjacentLeaf(
            layout.root,
            layout.focusedLeafId,
            FOCUS_DIRECTIONS[action.id],
          );
          if (!next) return false;
          focusTabLocalLeaf({ workspaceKey, hostTabId: layout.hostTabId, leafId: next });
          return true;
        }
        default:
          return false;
      }
    },
    [onCloseTab, split, workspaceKey],
  );
  useKeyboardActionHandler({
    handlerId: buildWorkspaceKeyboardHandlerId({
      name: "tab-local-splits",
      serverId: input.serverId,
      workspaceId: input.workspaceId,
    }),
    actions: [
      "workspace.tab.split-local.right",
      "workspace.tab.split-local.below",
      "workspace.tab.zoom-leaf",
      "workspace.tab.close-current",
      "workspace.pane.focus.left",
      "workspace.pane.focus.right",
      "workspace.pane.focus.up",
      "workspace.pane.focus.down",
    ] as const,
    enabled: input.enabled,
    // Ahead of the workspace's own handlers (100), which take over when this returns false.
    priority: 110,
    handle,
  });
}

function useFocusedTabIsComposite(workspaceKey: string): boolean {
  const layouts = useWorkspaceTabLocalLayouts(workspaceKey);
  const focusedTabId = useWorkspaceLayoutStore((state) => {
    const layout = state.layoutByWorkspace[workspaceKey];
    return layout ? (findPaneById(layout.root, layout.focusedPaneId)?.focusedTabId ?? null) : null;
  });
  return Boolean(focusedTabId && layouts[focusedTabId]);
}

function useTabLocalSplitsCommandCenter(input: { workspaceKey: string; enabled: boolean }) {
  const { t } = useTranslation();
  const dispatcher = useKeyboardActionDispatcher();
  const { overrides } = useKeyboardShortcutOverrides();
  const isComposite = useFocusedTabIsComposite(input.workspaceKey);
  const actions = useMemo<CommandCenterContribution[]>(() => {
    const platform = { isMac: getShortcutOs() === "mac", isDesktop: getIsElectron() };
    const entry = (spec: {
      id: string;
      rank: number;
      title: string;
      keywords: string[];
      icon: CommandCenterIcon;
      helpId: string;
      action: KeyboardActionDefinition;
    }): CommandCenterContribution => ({
      id: spec.id,
      group: "workspace",
      groupRank: -1,
      rank: spec.rank,
      keywords: spec.keywords,
      visibility: "query",
      run: () => {
        dispatcher.dispatch(spec.action);
      },
      presentation: {
        kind: "action",
        title: spec.title,
        sectionTitle: t("workspace.header.actions.workspaceActions"),
        icon: spec.icon,
        shortcutKeys: resolveShortcutKeysForAction(spec.helpId, overrides, platform) ?? undefined,
      },
    });
    const split = [
      entry({
        id: "tab-local:split-right",
        rank: 48,
        title: t("workspace.tabs.actions.tabLocal.splitRight"),
        keywords: ["split", "this", "tab", "inside", "right"],
        icon: SPLIT_ICON,
        helpId: "workspace-tab-split-local-right",
        action: { id: "workspace.tab.split-local.right", scope: "workspace" },
      }),
      entry({
        id: "tab-local:split-below",
        rank: 49,
        title: t("workspace.tabs.actions.tabLocal.splitBelow"),
        keywords: ["split", "this", "tab", "inside", "below", "down"],
        icon: SPLIT_BELOW_ICON,
        helpId: "workspace-tab-split-local-below",
        action: { id: "workspace.tab.split-local.below", scope: "workspace" },
      }),
    ];
    if (!isComposite) return split;
    return [
      ...split,
      entry({
        id: "tab-local:zoom-leaf",
        rank: 49.5,
        title: t("workspace.tabs.actions.tabLocal.zoomLeaf"),
        keywords: ["zoom", "leaf", "maximize", "split"],
        icon: ZOOM_ICON,
        helpId: "workspace-tab-zoom-leaf",
        action: { id: "workspace.tab.zoom-leaf", scope: "workspace" },
      }),
    ];
  }, [dispatcher, isComposite, overrides, t]);
  useCommandCenterActions({ sourceId: "tab-local-splits", enabled: input.enabled, actions });
}

/** Mounted once by the workspace screen; renders nothing. */
export function TabLocalSplitsWorkspace(props: {
  workspaceKey: string | null;
  serverId: string;
  workspaceId: string;
  /** The desktop split layout is on screen. Compact layouts keep flat tabs and are left alone. */
  enabled: boolean;
  routeFocused: boolean;
  onCloseTab: (tabId: string) => Promise<void> | void;
}) {
  const workspaceKey = props.workspaceKey ?? "";
  const enabled = props.enabled && workspaceKey !== "";
  const commandsEnabled = enabled && props.routeFocused;
  useTabLocalSplitsSync({ workspaceKey, enabled });
  useTabLocalSplitsKeyboard({
    workspaceKey,
    serverId: props.serverId,
    workspaceId: props.workspaceId,
    enabled: commandsEnabled,
    onCloseTab: props.onCloseTab,
  });
  useTabLocalSplitsCommandCenter({ workspaceKey, enabled: commandsEnabled });
  return null;
}

/** The focused pane's tabs as the strip shows them, for tab cycling and Cmd+1-9. */
export function useTabLocalStripTabs(input: {
  workspaceKey: string | null;
  tabs: WorkspaceTabDescriptor[];
  /** Compact layouts list members as ordinary tabs. */
  isCompact: boolean;
}): WorkspaceTabDescriptor[] {
  const enabled = !input.isCompact && supportsDesktopPaneSplits();
  const layouts = useWorkspaceTabLocalLayouts(enabled ? input.workspaceKey : null);
  const { tabs } = input;
  return useMemo(() => {
    const hostByMember = buildHostByMemberTabId(layouts);
    return hostByMember.size === 0 ? tabs : tabs.filter((tab) => !hostByMember.has(tab.tabId));
  }, [tabs, layouts]);
}

/**
 * Agents shown in a leaf are on screen even though only the host is the pane's active tab, so
 * timeline sync has to follow them too.
 */
export function useTabLocalVisibleAgentIds(input: {
  workspaceKey: string | null;
  layout: WorkspaceLayout | null;
  agentIds: string[];
  isCompact: boolean;
  focusedPaneOnly: boolean;
}): string[] {
  const { layout, agentIds, focusedPaneOnly } = input;
  const enabled = !input.isCompact && supportsDesktopPaneSplits();
  const layouts = useWorkspaceTabLocalLayouts(enabled ? input.workspaceKey : null);
  const merged = useMemo(() => {
    if (!layout || Object.keys(layouts).length === 0) return agentIds;
    const panes = collectAllPanes(layout.root).filter(
      (pane) => !focusedPaneOnly || pane.id === layout.focusedPaneId,
    );
    const tabsById = new Map(collectAllTabs(layout.root).map((tab) => [tab.tabId, tab]));
    const ids = new Set(agentIds);
    for (const pane of panes) {
      const composite = pane.focusedTabId ? layouts[pane.focusedTabId] : undefined;
      for (const tabId of composite ? collectLeafTabIds(composite) : []) {
        const target = tabsById.get(tabId)?.target;
        if (target?.kind === "agent") ids.add(target.agentId);
      }
    }
    return [...ids].sort();
  }, [agentIds, focusedPaneOnly, layout, layouts]);
  const stableRef = useRef(merged);
  if (
    stableRef.current.length !== merged.length ||
    stableRef.current.some((agentId, index) => agentId !== merged[index])
  ) {
    stableRef.current = merged;
  }
  return stableRef.current;
}
