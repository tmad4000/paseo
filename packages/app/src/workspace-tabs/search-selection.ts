import { useCallback, useEffect, useState } from "react";
import { supportsDesktopPaneSplits } from "@/constants/layout";
import type { ExplorerCheckoutContext } from "@/stores/explorer-checkout-context";
import { usePanelStore } from "@/stores/panel-store";
import {
  collectAllTabs,
  findPaneById,
  findPaneContainingTab,
  selectExplorerSidebarPaneId,
  useWorkspaceLayoutStore,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-store";
import { openExplorerSidebarView } from "./explorer-sidebar";

export interface CompactSearchPane {
  workspaceKey: string;
  paneId: string;
  mainPaneId: string | null;
  mainTabId: string | null;
}

function explorerView(kind: string) {
  if (kind === "files") return "files" as const;
  if (kind === "changes_tree") return "changes" as const;
  if (kind === "pull_request") return "pr" as const;
  return null;
}

/** Explorer keeps durable main focus; compact search can present its existing content pane. */
export function selectWorkspaceSearchTab(input: {
  workspaceKey: string | null;
  tabId: string;
  singlePane: boolean;
  isCompact: boolean;
  checkout: ExplorerCheckoutContext | null;
  fallbackPaneId?: string | null;
}): CompactSearchPane | null {
  if (!input.workspaceKey) return null;
  const store = useWorkspaceLayoutStore.getState();
  const layout = store.layoutByWorkspace[input.workspaceKey];
  if (!layout) return null;
  const tab = collectAllTabs(layout.root).find((candidate) => candidate.tabId === input.tabId);
  const pane = findPaneContainingTab(layout.root, input.tabId);
  if (!tab || !pane) return null;
  const view = explorerView(tab.target.kind);
  if (input.singlePane && view) {
    openExplorerSidebarView({ ...input, view });
    return null;
  }
  const mainPaneId = layout.focusedPaneId ?? input.fallbackPaneId ?? null;
  const mainPane = findPaneById(layout.root, mainPaneId ?? "");
  store.focusTab(input.workspaceKey, input.tabId);
  const panel = usePanelStore.getState();
  if (!input.singlePane) {
    if (pane.id === selectExplorerSidebarPaneId(store, input.workspaceKey)) panel.exitFocusMode();
    return null;
  }
  panel.showMobileAgent();
  if (pane.id !== selectExplorerSidebarPaneId(store, input.workspaceKey)) return null;
  return {
    workspaceKey: input.workspaceKey,
    paneId: pane.id,
    mainPaneId,
    mainTabId: mainPane?.focusedTabId ?? null,
  };
}

export function resolveSearchPresentedPane(input: {
  selection: CompactSearchPane | null;
  workspaceKey: string | null;
  layout: WorkspaceLayout | null;
  singlePane: boolean;
  fallbackPaneId?: string | null;
}): string | null {
  const { selection, workspaceKey, layout, singlePane } = input;
  const mainPaneId = layout?.focusedPaneId ?? input.fallbackPaneId ?? null;
  if (!singlePane || !layout || !selection || selection.workspaceKey !== workspaceKey)
    return mainPaneId;
  const mainPane = findPaneById(layout.root, mainPaneId ?? "");
  if (selection.mainPaneId !== mainPaneId || selection.mainTabId !== mainPane?.focusedTabId)
    return mainPaneId;
  const pane = findPaneById(layout.root, selection.paneId);
  const target = collectAllTabs(layout.root).find(
    (tab) => tab.tabId === pane?.focusedTabId,
  )?.target;
  return target && !explorerView(target.kind) ? (pane?.id ?? mainPaneId) : mainPaneId;
}

export function useWorkspaceTabSearchSelection(input: {
  workspaceKey: string | null;
  layout: WorkspaceLayout | null;
  isCompact: boolean;
  checkout: ExplorerCheckoutContext | null;
  enabled: boolean;
  fallbackPaneId?: string | null;
}) {
  const [selection, setSelection] = useState<CompactSearchPane | null>(null);
  const singlePane = input.isCompact || !supportsDesktopPaneSplits();
  const { workspaceKey, isCompact, checkout, enabled, fallbackPaneId } = input;
  const clearSelection = useCallback(() => setSelection(null), []);
  useEffect(() => {
    if (!enabled || !singlePane) clearSelection();
  }, [clearSelection, enabled, singlePane]);
  const onSelect = useCallback(
    (tabId: string) => {
      setSelection(
        selectWorkspaceSearchTab({
          workspaceKey,
          tabId,
          singlePane,
          isCompact,
          checkout,
          fallbackPaneId,
        }),
      );
    },
    [checkout, isCompact, singlePane, workspaceKey, fallbackPaneId],
  );
  return {
    onSelect,
    presentedPaneId: resolveSearchPresentedPane({ ...input, selection, singlePane }),
  };
}
