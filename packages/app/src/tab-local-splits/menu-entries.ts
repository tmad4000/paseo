import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { WorkspaceTabMenuEntry } from "@/screens/workspace/workspace-tab-menu";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { supportsDesktopPaneSplits } from "@/constants/layout";
import { useViewPaneActions } from "@/views/view-pane-actions";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { canHostTabLocalSplit } from "@/tab-local-splits/commands";
import { useSplitThisTab } from "@/tab-local-splits/workspace-integration";

const CLOSE_GROUP_FIRST_KEY = "close-before";

/** Splices the entries in directly above the Close… group (below Rename, when there is one). */
export function withTabLocalSplitMenuEntries(
  entries: WorkspaceTabMenuEntry[],
  tabLocalEntries: WorkspaceTabMenuEntry[],
): WorkspaceTabMenuEntry[] {
  if (tabLocalEntries.length === 0) return entries;
  const index = entries.findIndex((entry) => entry.key === CLOSE_GROUP_FIRST_KEY);
  const at = index < 0 ? entries.length : index;
  return [
    ...entries.slice(0, at),
    ...tabLocalEntries,
    { kind: "separator", key: "tab-local-split-separator" },
    ...entries.slice(at),
  ];
}

/** "Split this tab right / below" for a strip chip's context menu. Disabled inside Views. */
export function useTabLocalSplitMenuEntries(input: {
  tab: WorkspaceTabDescriptor;
  serverId: string;
  workspaceId: string;
  menuTestIDBase: string;
}): WorkspaceTabMenuEntry[] {
  const { tab, serverId, workspaceId, menuTestIDBase } = input;
  const { t } = useTranslation();
  const inView = Boolean(useViewPaneActions());
  const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId }) ?? "";
  const split = useSplitThisTab(workspaceKey);
  return useMemo(() => {
    // Composites render only where workspace pane splits do (web and desktop).
    if (!supportsDesktopPaneSplits() || !canHostTabLocalSplit(tab.target) || !workspaceKey) {
      return [];
    }
    // Views carry per-tab scope and cross-host targets; the chooser's "existing tab" needs its
    // own pass there (Phase 2).
    const tooltip = inView ? t("workspace.tabs.actions.tabLocal.viewsUnavailable") : undefined;
    return [
      {
        kind: "item",
        key: "tab-local-split-right",
        label: t("workspace.tabs.actions.tabLocal.splitRight"),
        icon: "columns-2",
        disabled: inView,
        tooltip,
        testID: `${menuTestIDBase}-split-this-tab-right`,
        onSelect: () => split(tab.tabId, "right"),
      },
      {
        kind: "item",
        key: "tab-local-split-below",
        label: t("workspace.tabs.actions.tabLocal.splitBelow"),
        icon: "rows-2",
        disabled: inView,
        tooltip,
        testID: `${menuTestIDBase}-split-this-tab-below`,
        onSelect: () => split(tab.tabId, "below"),
      },
    ];
  }, [inView, menuTestIDBase, split, t, tab.tabId, tab.target, workspaceKey]);
}
