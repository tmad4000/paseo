import { useMemo } from "react";
import equal from "fast-deep-equal";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { useSessionStore } from "@/stores/session-store";
import type { WorkspaceTab } from "@/workspace-tabs/model";
import {
  buildWorkspacePaneContentModel,
  type WorkspacePaneContentModel,
} from "@/screens/workspace/workspace-pane-content";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";

/**
 * A workspace split can show a session that lives in another workspace on the same host:
 * "Split with session" from the pane menu, or an agent's `open_tab` with side placement. Agent
 * ids are unique per host and the session already knows each agent's home workspace, so no
 * extra tab state is stored — a tab is foreign when its agent's workspace is not this one.
 *
 * A foreign session keeps its own workspace for everything workspace-shaped (its composer,
 * attachments, diff) and opens files and other tabs in that home workspace. Closing its tab only
 * removes it from this layout; it never archives the session (see close-tab-policy).
 */
export function useForeignSessionWorkspaces(input: {
  serverId: string;
  workspaceId: string;
  tabs: readonly WorkspaceTab[];
}): ReadonlyMap<string, string> {
  const { serverId, workspaceId, tabs } = input;
  const agentIds = useMemo(
    () => tabs.flatMap((tab) => (tab.target.kind === "agent" ? [tab.target.agentId] : [])),
    [tabs],
  );
  const entries = useStoreWithEqualityFn(
    useSessionStore,
    (state) => {
      const session = state.sessions[serverId];
      if (!session) return [];
      const foreign: [string, string][] = [];
      for (const agentId of agentIds) {
        const home = (session.agents.get(agentId) ?? session.agentDetails.get(agentId))
          ?.workspaceId;
        if (home && home !== workspaceId) foreign.push([agentId, home]);
      }
      return foreign;
    },
    equal,
  );
  return useMemo(() => new Map(entries), [entries]);
}

export function buildForeignSessionPaneContentModel(input: {
  tab: WorkspaceTabDescriptor;
  serverId: string;
  homeWorkspaceId: string;
  onCloseCurrentTab: () => void;
}): WorkspacePaneContentModel {
  const { serverId, homeWorkspaceId } = input;
  const openAtHome = (target: WorkspaceTabDescriptor["target"]) => {
    navigateToWorkspace({ serverId, workspaceId: homeWorkspaceId, target });
  };
  return buildWorkspacePaneContentModel({
    tab: input.tab,
    normalizedServerId: serverId,
    normalizedWorkspaceId: homeWorkspaceId,
    host: "main",
    onOpenTab: openAtHome,
    onOpenPreferredTarget: openAtHome,
    onCloseCurrentTab: input.onCloseCurrentTab,
    onRetargetCurrentTab: openAtHome,
    onSetCurrentTabState: () => {},
    onOpenWorkspaceFile: (request) => {
      openAtHome({ kind: "file", ...request.location });
    },
    onOpenImportSheet: () => {},
  });
}
