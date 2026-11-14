import { useCallback, useMemo, type ReactNode } from "react";
import { i18n } from "@/i18n/i18next";
import { useModifiedPanelTabIds } from "@/panels/panel-instance-attributes";
import type { UnreadTabStates } from "@/screens/workspace/workspace-tab-activity";
import type { WorkspacePaneContentModel } from "@/screens/workspace/workspace-pane-content";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { useWorkspaceTabLocalLayouts } from "@/stores/tab-local-splits-store";
import type { TabLocalCandidate } from "@/tab-local-splits/chooser";
import { canHostTabLocalSplit } from "@/tab-local-splits/commands";
import {
  buildHostByMemberTabId,
  collectLeafTabIds,
  collectMemberTabIds,
  countLeaves,
  getTopLevelDirection,
  type TabLocalDirection,
  type TabLocalLayouts,
} from "@/tab-local-splits/model";
import { TabLocalSplitView } from "@/tab-local-splits/tab-local-split-view";

/** What a composite host's strip chip shows after its title. */
export interface TabLocalChip {
  leafCount: number;
  direction: TabLocalDirection;
  /** "3 views in this tab: Agent · Terminal · Browser" */
  summary: string;
  /** A member has unsaved changes. */
  modified: boolean;
}

export interface TabLocalPaneTabContent {
  render: (input: { tab: WorkspaceTabDescriptor; interactive: boolean }) => ReactNode | null;
  /** Hosts whose members hold unsaved work, kept mounted like a modified tab. */
  retainedTabIds: ReadonlySet<string>;
}

export interface TabLocalPane {
  stripTabs: WorkspaceTabDescriptor[];
  activeTabId: string | null;
  unreadTabIds: UnreadTabStates;
  chipByTabId: ReadonlyMap<string, TabLocalChip>;
  tabContent: TabLocalPaneTabContent | undefined;
  /** Closing a host closes its members first, each through its own close policy. */
  closeTab: (tabId: string) => Promise<void>;
  /** A strip tab list for bulk close, with each listed composite's members (never `tabId`'s). */
  expandForBulkClose: (tabId: string, tabs: WorkspaceTabDescriptor[]) => WorkspaceTabDescriptor[];
}

interface UseTabLocalPaneInput {
  enabled: boolean;
  workspaceKey: string;
  paneId: string;
  paneTabs: WorkspaceTabDescriptor[];
  activeTabId: string | null;
  unreadTabIds: UnreadTabStates;
  serverId: string;
  workspaceId: string;
  isWorkspaceFocused: boolean;
  buildPaneContentModel: (input: {
    paneId: string;
    tab: WorkspaceTabDescriptor;
  }) => WorkspacePaneContentModel;
  onFocusPane: (paneId: string) => void;
  onCloseTab: (tabId: string) => Promise<void> | void;
}

const EMPTY_LAYOUTS: TabLocalLayouts = {};
const EMPTY_CHIPS: ReadonlyMap<string, TabLocalChip> = new Map();

const KIND_LABEL_KEYS: Partial<Record<WorkspaceTabDescriptor["kind"], string>> = {
  agent: "workspace.tabs.fallback.agent",
  draft: "workspace.tabs.fallback.newAgent",
  terminal: "workspace.tabs.fallback.terminal",
  browser: "workspace.tabs.fallback.browser",
};

function kindLabel(tab: WorkspaceTabDescriptor | undefined): string {
  if (!tab) return "";
  if (tab.target.kind === "file") {
    return tab.target.path.split("/").findLast(Boolean) ?? tab.target.path;
  }
  const key = KIND_LABEL_KEYS[tab.kind];
  return key ? i18n.t(key) : tab.kind;
}

function mergeUnread(unreadTabIds: UnreadTabStates, layouts: TabLocalLayouts): UnreadTabStates {
  const hosts = Object.values(layouts);
  if (hosts.length === 0) return unreadTabIds;
  const merged = new Map(unreadTabIds);
  for (const layout of hosts) {
    const states = collectLeafTabIds(layout).flatMap((tabId) => {
      const state = unreadTabIds.get(tabId);
      return state ? [state] : [];
    });
    if (states.length === 0) continue;
    // A member that needs attention lights the host; "seen" only when every unread leaf was seen.
    merged.set(layout.hostTabId, states.every((state) => state === "seen") ? "seen" : "new");
  }
  return merged;
}

/**
 * The fork's view of one workspace pane: which tabs the strip shows, how composite chips read,
 * and what renders when a composite is the active tab.
 */
export function useTabLocalPane(input: UseTabLocalPaneInput): TabLocalPane {
  const {
    enabled,
    workspaceKey,
    paneId,
    paneTabs,
    activeTabId,
    unreadTabIds,
    serverId,
    workspaceId,
    isWorkspaceFocused,
    buildPaneContentModel,
    onFocusPane,
    onCloseTab,
  } = input;
  const workspaceLayouts = useWorkspaceTabLocalLayouts(enabled ? workspaceKey : null);
  const paneTabIds = useMemo(() => new Set(paneTabs.map((tab) => tab.tabId)), [paneTabs]);
  const layouts = useMemo(() => {
    const hosted = Object.values(workspaceLayouts).filter((layout) =>
      paneTabIds.has(layout.hostTabId),
    );
    return hosted.length === 0
      ? EMPTY_LAYOUTS
      : Object.fromEntries(hosted.map((layout) => [layout.hostTabId, layout]));
  }, [paneTabIds, workspaceLayouts]);
  const hostByMember = useMemo(() => buildHostByMemberTabId(layouts), [layouts]);
  const tabsById = useMemo(() => new Map(paneTabs.map((tab) => [tab.tabId, tab])), [paneTabs]);
  const stripTabs = useMemo(
    () =>
      hostByMember.size === 0 ? paneTabs : paneTabs.filter((tab) => !hostByMember.has(tab.tabId)),
    [hostByMember, paneTabs],
  );
  const memberTabIds = useMemo(() => [...hostByMember.keys()], [hostByMember]);
  const modifiedMembers = useModifiedPanelTabIds({ serverId, workspaceId, tabIds: memberTabIds });

  const chipByTabId = useMemo(() => {
    const hosts = Object.values(layouts);
    if (hosts.length === 0) return EMPTY_CHIPS;
    return new Map(
      hosts.map((layout) => {
        const leafCount = countLeaves(layout);
        const kinds = collectLeafTabIds(layout)
          .map((tabId) => kindLabel(tabsById.get(tabId)))
          .join(" · ");
        return [
          layout.hostTabId,
          {
            leafCount,
            direction: getTopLevelDirection(layout),
            summary: i18n.t("workspace.tabs.actions.tabLocal.stripSummary", {
              count: leafCount,
              kinds,
            }),
            modified: collectMemberTabIds(layout).some((tabId) => modifiedMembers.has(tabId)),
          },
        ];
      }),
    );
  }, [layouts, modifiedMembers, tabsById]);

  const candidatesByHost = useMemo(() => {
    const workspaceHostByMember = buildHostByMemberTabId(workspaceLayouts);
    return (hostTabId: string): TabLocalCandidate[] => {
      const own = new Set(layouts[hostTabId] ? collectLeafTabIds(layouts[hostTabId]) : []);
      return paneTabs
        .filter((tab) => !own.has(tab.tabId) && canHostTabLocalSplit(tab.target))
        .map((tab) => {
          const groupHost = workspaceHostByMember.get(tab.tabId);
          return { tab, groupedUnder: groupHost ? (tabsById.get(groupHost) ?? null) : null };
        });
    };
  }, [layouts, paneTabs, tabsById, workspaceLayouts]);

  const retainedTabIds = useMemo(
    () =>
      new Set(
        Object.values(layouts)
          .filter((layout) =>
            collectMemberTabIds(layout).some((tabId) => modifiedMembers.has(tabId)),
          )
          .map((layout) => layout.hostTabId),
      ),
    [layouts, modifiedMembers],
  );

  const tabContent = useMemo<TabLocalPaneTabContent | undefined>(() => {
    if (Object.keys(layouts).length === 0) return undefined;
    return {
      retainedTabIds,
      render: ({ tab, interactive }) => {
        const layout = layouts[tab.tabId];
        if (!layout) return null;
        return (
          <TabLocalSplitView
            workspaceKey={workspaceKey}
            paneId={paneId}
            layout={layout}
            tabsById={tabsById}
            candidates={candidatesByHost(tab.tabId)}
            serverId={serverId}
            workspaceId={workspaceId}
            isWorkspaceFocused={isWorkspaceFocused}
            interactive={interactive}
            buildPaneContentModel={buildPaneContentModel}
            onFocusPane={onFocusPane}
            onCloseTab={onCloseTab}
          />
        );
      },
    };
  }, [
    buildPaneContentModel,
    candidatesByHost,
    isWorkspaceFocused,
    layouts,
    onCloseTab,
    onFocusPane,
    paneId,
    retainedTabIds,
    serverId,
    tabsById,
    workspaceId,
    workspaceKey,
  ]);

  const closeTab = useCallback(
    async (tabId: string) => {
      const layout = layouts[tabId];
      for (const memberTabId of layout ? collectMemberTabIds(layout) : []) {
        await onCloseTab(memberTabId);
      }
      await onCloseTab(tabId);
    },
    [layouts, onCloseTab],
  );

  const expandForBulkClose = useCallback(
    (tabId: string, tabs: WorkspaceTabDescriptor[]) =>
      tabs.flatMap((tab) => {
        const layout = tab.tabId === tabId ? undefined : layouts[tab.tabId];
        const members = layout ? collectMemberTabIds(layout) : [];
        return [tab, ...members.flatMap((memberTabId) => tabsById.get(memberTabId) ?? [])];
      }),
    [layouts, tabsById],
  );

  const resolvedActiveTabId =
    (activeTabId ? hostByMember.get(activeTabId) : undefined) ?? activeTabId;
  const mergedUnread = useMemo(() => mergeUnread(unreadTabIds, layouts), [layouts, unreadTabIds]);

  return {
    stripTabs,
    activeTabId: resolvedActiveTabId,
    unreadTabIds: mergedUnread,
    chipByTabId,
    tabContent,
    closeTab,
    expandForBulkClose,
  };
}
