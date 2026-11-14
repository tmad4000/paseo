import { memo, useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { RetainedPanel } from "@/components/retained-panel";
import { useModifiedPanelTabIds } from "@/panels/panel-instance-attributes";
import {
  WorkspacePaneContent,
  type WorkspacePaneContentModel,
} from "@/screens/workspace/workspace-pane-content";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { useMountedTabSet } from "@/screens/workspace/use-mounted-tab-set";
import { workspaceTabTargetsEqual } from "@/workspace-tabs/identity";
import { RenderProfile } from "@/utils/render-profiler";
import { useViewPaneActions } from "@/views/view-pane-actions";

interface WorkspacePanelHostProps {
  paneId: string;
  tabs: WorkspaceTabDescriptor[];
  activeTabId: string | null;
  normalizedServerId: string;
  normalizedWorkspaceId: string;
  isWorkspaceFocused: boolean;
  isPaneFocused: boolean;
  onFocusPane?: (paneId: string) => void;
  buildPaneContentModel: (input: {
    paneId: string;
    tab: WorkspaceTabDescriptor;
  }) => WorkspacePaneContentModel;
  /** Replaces a mounted tab's panel (fork: a tab-local split's composite). */
  tabContent?: WorkspacePanelHostTabContent;
}

export interface WorkspacePanelHostTabContent {
  /** `null` keeps the tab's own panel. */
  render: (input: { tab: WorkspaceTabDescriptor; interactive: boolean }) => ReactNode | null;
  /** Kept mounted like a modified tab. */
  retainedTabIds: ReadonlySet<string>;
}

interface MountedTabProps {
  tab: WorkspaceTabDescriptor;
  paneId: string;
  visible: boolean;
  interactive: boolean;
  isWorkspaceFocused: boolean;
  onFocusPane?: (paneId: string) => void;
  buildPaneContentModel: WorkspacePanelHostProps["buildPaneContentModel"];
  override: ReactNode | null;
}

const MountedTab = memo(function MountedTab({
  tab,
  paneId,
  visible,
  interactive,
  isWorkspaceFocused,
  onFocusPane,
  buildPaneContentModel,
  override,
}: MountedTabProps) {
  const content = useMemo(
    () => buildPaneContentModel({ paneId, tab }),
    [buildPaneContentModel, paneId, tab],
  );
  const handleFocusPane = useCallback(() => onFocusPane?.(paneId), [onFocusPane, paneId]);
  return (
    <RenderProfile id={`DesktopMountedTab:${tab.kind}:${tab.tabId}`}>
      <RetainedPanel active={visible}>
        {override ?? (
          <WorkspacePaneContent
            content={content}
            isWorkspaceFocused={isWorkspaceFocused}
            isPaneFocused={interactive}
            onFocusPane={onFocusPane ? handleFocusPane : undefined}
          />
        )}
      </RetainedPanel>
    </RenderProfile>
  );
});

function useStableTabs(tabs: WorkspaceTabDescriptor[]) {
  const cacheRef = useRef(new Map<string, WorkspaceTabDescriptor>());
  const stableTabs = useMemo(() => {
    const next = new Map<string, WorkspaceTabDescriptor>();
    for (const tab of tabs) {
      const cached = cacheRef.current.get(tab.tabId);
      next.set(
        tab.tabId,
        cached &&
          cached.key === tab.key &&
          cached.kind === tab.kind &&
          cached.state === tab.state &&
          cached.scope?.serverId === tab.scope?.serverId &&
          cached.scope?.workspaceId === tab.scope?.workspaceId &&
          workspaceTabTargetsEqual(cached.target, tab.target)
          ? cached
          : tab,
      );
    }
    return next;
  }, [tabs]);
  useEffect(() => {
    cacheRef.current = stableTabs;
  }, [stableTabs]);
  return stableTabs;
}

/** Mounts panel implementations behind the shared host contract and retains modified tabs. */
export function WorkspacePanelHost({
  paneId,
  tabs,
  activeTabId,
  normalizedServerId,
  normalizedWorkspaceId,
  isWorkspaceFocused,
  isPaneFocused,
  onFocusPane,
  buildPaneContentModel,
  tabContent,
}: WorkspacePanelHostProps) {
  const viewPaneActions = useViewPaneActions();
  const tabIds = useMemo(() => tabs.map((tab) => tab.tabId), [tabs]);
  const modifiedTabIds = useModifiedPanelTabIds({
    serverId: normalizedServerId,
    workspaceId: normalizedWorkspaceId,
    tabIds,
  });
  const extraRetainedTabIds = tabContent?.retainedTabIds;
  const retainedTabIds = useMemo(
    () =>
      extraRetainedTabIds?.size
        ? new Set([...modifiedTabIds, ...extraRetainedTabIds])
        : modifiedTabIds,
    [extraRetainedTabIds, modifiedTabIds],
  );
  const stableTabs = useStableTabs(tabs);
  const { mountedTabIds } = useMountedTabSet({
    activeTabId,
    allTabIds: tabIds,
    retainedTabIds,
    cap: 3,
  });
  const mountedIds = useMemo(
    () => tabIds.filter((tabId) => mountedTabIds.has(tabId)),
    [mountedTabIds, tabIds],
  );

  if (tabIds.length === 0 && viewPaneActions) {
    return viewPaneActions.renderEmptyPane(paneId);
  }

  return mountedIds.map((tabId) => {
    const tab = stableTabs.get(tabId);
    if (!tab) return null;
    const visible = tabId === activeTabId;
    const interactive = isPaneFocused && visible;
    return (
      <MountedTab
        key={tabId}
        tab={tab}
        paneId={paneId}
        visible={visible}
        interactive={interactive}
        isWorkspaceFocused={isWorkspaceFocused}
        onFocusPane={onFocusPane}
        buildPaneContentModel={buildPaneContentModel}
        override={tabContent?.render({ tab, interactive }) ?? null}
      />
    );
  });
}
