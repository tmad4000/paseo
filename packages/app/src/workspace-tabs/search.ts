import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import {
  collectAllTabs,
  type WorkspaceLayout,
  type SplitNode,
  type SplitPane,
} from "@/stores/workspace-layout-actions";

export interface WorkspaceTabSearchEntry {
  tab: WorkspaceTabDescriptor;
  paneId: string;
  paneTabIds: readonly string[];
  paneNumber: number;
  explorer: boolean;
  hidden: boolean;
}

function collectSearchPanes(node: SplitNode): SplitPane[] {
  if (node.kind === "pane") return [node.pane];
  return node.group.children.flatMap(collectSearchPanes);
}

/** Search the saved layout, including the separately rendered/hidden Explorer dock. */
export function collectWorkspaceTabSearchEntries(
  layout: WorkspaceLayout | null,
  explorerPaneId: string | null,
): WorkspaceTabSearchEntry[] {
  if (!layout) return [];
  const tabs = new Map(collectAllTabs(layout.root).map((tab) => [tab.tabId, tab]));
  let paneNumber = 0;
  return collectSearchPanes(layout.root).flatMap((pane) => {
    const explorer = pane.id === explorerPaneId;
    if (!explorer) paneNumber++;
    return pane.tabIds.flatMap((tabId) => {
      const tab = tabs.get(tabId);
      return tab
        ? [
            {
              tab: { ...tab, key: tab.tabId, kind: tab.target.kind },
              paneId: pane.id,
              paneTabIds: pane.tabIds,
              paneNumber,
              explorer,
              hidden: pane.hidden === true,
            },
          ]
        : [];
    });
  });
}
