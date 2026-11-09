import {
  canDismissPaneInLayout,
  collectAllTabs,
  findPaneContainingTab,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-actions";
import type { NavigationFocusHistory } from "./focus-history";

/** Returns false when normal tab/pane closing should choose the next tab. */
export function closeLastBlankTab(input: {
  serverId: string;
  workspaceId: string;
  tabId: string;
  layout: WorkspaceLayout;
  explorerSidebarPaneId: string | null;
  history: NavigationFocusHistory;
  closeTab: () => void;
  navigateBack: (steps: number) => boolean;
  navigateSessions: () => void;
}): boolean {
  const pane = findPaneContainingTab(input.layout.root, input.tabId);
  if (
    pane?.tabIds.length !== 1 ||
    collectAllTabs(input.layout.root).find((tab) => tab.tabId === input.tabId)?.target.kind !==
      "new_tab" ||
    canDismissPaneInLayout(input.layout, pane.id, input.explorerSidebarPaneId)
  ) {
    return false;
  }

  input.history.forgetTab(input.serverId, input.workspaceId, input.tabId);
  input.closeTab();
  // Returning to this empty workspace, another launcher or a transient creation
  // screen would make Close appear to do nothing. Prefer the nearest useful visit.
  const index = input.history.getSnapshot().backEntries.findIndex((location) => {
    if (location.kind === "route") return !/^\/new(?:\/|$|\?)/.test(location.pathname);
    return (
      (location.serverId !== input.serverId || location.workspaceId !== input.workspaceId) &&
      location.target !== null &&
      location.target.kind !== "new_tab"
    );
  });
  if (index < 0 || !input.navigateBack(index + 1)) input.navigateSessions();
  return true;
}
