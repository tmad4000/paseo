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
}): {
  /** Foreign agent id → its home workspace id. */
  homeByAgentId: ReadonlyMap<string, string>;
  /**
   * Foreign sessions that have since been archived. Their tabs are pinned (the explicit open),
   * so ordinary reconciliation would keep them; the workspace closes them instead.
   */
  archivedAgentIds: readonly string[];
} {
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
      const foreign: [string, string, boolean][] = [];
      for (const agentId of agentIds) {
        const agent = session.agents.get(agentId) ?? session.agentDetails.get(agentId);
        const home = agent?.workspaceId;
        if (home && home !== workspaceId) foreign.push([agentId, home, Boolean(agent?.archivedAt)]);
      }
      return foreign;
    },
    equal,
  );
  return useMemo(
    () => ({
      homeByAgentId: new Map(entries.map(([agentId, home]) => [agentId, home])),
      archivedAgentIds: entries.filter(([, , archived]) => archived).map(([agentId]) => agentId),
    }),
    [entries],
  );
}

export function buildForeignSessionPaneContentModel(input: {
  tab: WorkspaceTabDescriptor;
  serverId: string;
  homeWorkspaceId: string;
  /** The workspace whose layout holds this tab: tab operations (close, `/clear`) act there. */
  layoutWorkspaceId: string;
  onCloseCurrentTab: () => void;
  onRetargetCurrentTab: (target: WorkspaceTabDescriptor["target"]) => void;
}): WorkspacePaneContentModel {
  const { serverId, homeWorkspaceId } = input;
  const openAtHome = (target: WorkspaceTabDescriptor["target"]) => {
    navigateToWorkspace({ serverId, workspaceId: homeWorkspaceId, target });
  };
  return buildWorkspacePaneContentModel({
    tab: input.tab,
    normalizedServerId: serverId,
    normalizedWorkspaceId: homeWorkspaceId,
    layoutWorkspaceId: input.layoutWorkspaceId,
    host: "main",
    onOpenTab: openAtHome,
    onOpenPreferredTarget: openAtHome,
    onCloseCurrentTab: input.onCloseCurrentTab,
    onRetargetCurrentTab: input.onRetargetCurrentTab,
    onSetCurrentTabState: () => {},
    onOpenWorkspaceFile: (request) => {
      openAtHome({ kind: "file", ...request.location });
    },
    onOpenImportSheet: () => {},
  });
}
