import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { findPaneContainingTab } from "@/stores/workspace-layout-actions";
import {
  navigateToWorkspace,
  type ActiveWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import { getDesktopHost } from "@/desktop/host";
import { supportsDesktopPaneSplits } from "@/constants/layout";
import { usePanelStore } from "@/stores/panel-store";
import {
  normalizeWorkspaceOpaqueId,
  resolveWorkspaceMapKeyByIdentity,
} from "@/utils/workspace-identity";
import {
  openSessionLinkWithPorts,
  SessionLinkError,
  type SessionLinkDisposition,
} from "./session-link";

export interface SessionLinkOrigin extends ActiveWorkspaceSelection {
  tabId: string;
  isCompact: boolean;
}

function isOriginInWorkspace(
  origin: SessionLinkOrigin | null | undefined,
  serverId: string,
  workspaceId: string,
): origin is SessionLinkOrigin {
  return origin != null && origin.serverId === serverId && origin.workspaceId === workspaceId;
}

export function canOpenSessionWindow(): boolean {
  const host = getDesktopHost();
  // COMPAT(agentTargetWindow): added in v0.10.0 beta; remove after 2027-05-12
  // once the desktop floor advertises agent-targeted windows. ready predates this support.
  return host?.window?.supportsAgentTarget === true && typeof host.window.openNew === "function";
}

export async function openSessionLink(
  href: string,
  disposition: SessionLinkDisposition = "current",
  getOrigin?: () => SessionLinkOrigin | null,
): Promise<void> {
  const runtime = getHostRuntimeStore();
  const desktop = getDesktopHost();
  const origin = getOrigin?.();
  return openSessionLinkWithPorts(href, disposition, {
    isKnownHost: (serverId) => runtime.getHosts().some((host) => host.serverId === serverId),
    resolveAgent: async ({ serverId, agentId }) => {
      const session = useSessionStore.getState().sessions[serverId];
      for (const cached of [session?.agents.get(agentId), session?.agentDetails.get(agentId)]) {
        const workspaceId = normalizeWorkspaceOpaqueId(cached?.workspaceId);
        if (cached?.id === agentId && workspaceId) return { id: cached.id, workspaceId };
      }
      const snapshot = runtime.getSnapshot(serverId);
      if (!snapshot?.client || snapshot.connectionStatus !== "online")
        throw new SessionLinkError("unavailable");
      const result = await snapshot.client.fetchAgent({ agentId });
      const agent = result?.agent;
      if (!agent) return null;
      return { id: agent.id, workspaceId: normalizeWorkspaceOpaqueId(agent.workspaceId) };
    },
    navigate: ({ serverId, agentId, workspaceId }, placement) => {
      let paneId: string | null = null;
      if (placement === "side") {
        const active = getOrigin?.();
        const store = useWorkspaceLayoutStore.getState();
        const workspaceKey = `${serverId}:${workspaceId}`;
        const layout = store.layoutByWorkspace[workspaceKey];
        const sourcePane =
          origin && layout ? findPaneContainingTab(layout.root, origin.tabId) : null;
        const workspaces = useSessionStore.getState().sessions[serverId]?.workspaces;
        if (
          !isOriginInWorkspace(origin, serverId, workspaceId) ||
          !isOriginInWorkspace(active, serverId, workspaceId) ||
          active.isCompact ||
          !supportsDesktopPaneSplits() ||
          usePanelStore.getState().desktop.focusModeEnabled ||
          active.tabId !== origin.tabId ||
          !sourcePane ||
          sourcePane.hidden === true ||
          sourcePane.focusedTabId !== origin.tabId ||
          store.sidePaneIdByWorkspace[workspaceKey] === sourcePane.id ||
          !useWorkspaceLayoutStore.persist.hasHydrated() ||
          !resolveWorkspaceMapKeyByIdentity({ workspaces, workspaceId })
        )
          throw new SessionLinkError("sideUnavailable");
        // The gesture's actual tab identifies its source even for an unfocused context menu.
        // Do not focus or replace that pane when it is already the remembered side pane.
        paneId = store.ensureSidePane(workspaceKey, { focus: false });
        if (!paneId || paneId === sourcePane.id) throw new SessionLinkError("sideUnavailable");
      }
      navigateToWorkspace({
        serverId,
        workspaceId,
        target: { kind: "agent", agentId },
        pin: true,
        placement: paneId ? { mode: "pane", paneId } : { mode: "focused" },
      });
    },
    openWindow:
      canOpenSessionWindow() && desktop?.window?.openNew
        ? (target) => desktop.window!.openNew!({ agent: target })
        : undefined,
  });
}
