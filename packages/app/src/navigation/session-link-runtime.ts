import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { getDesktopHost } from "@/desktop/host";
import { normalizeWorkspaceOpaqueId } from "@/utils/workspace-identity";
import {
  openSessionLinkWithPorts,
  SessionLinkError,
  type SessionLinkDisposition,
} from "./session-link";

export function canOpenSessionWindow(): boolean {
  const host = getDesktopHost();
  // Older desktop bridges accept openNew but ignore the agent target. The navigation
  // handshake identifies the bridge that can actually land the new window on a session.
  return (
    typeof host?.window?.openNew === "function" && typeof host.agentNavigation?.ready === "function"
  );
}

export async function openSessionLink(
  href: string,
  disposition: SessionLinkDisposition = "current",
): Promise<void> {
  const runtime = getHostRuntimeStore();
  const desktop = getDesktopHost();
  return openSessionLinkWithPorts(href, disposition, {
    isKnownHost: (serverId) => runtime.getHosts().some((host) => host.serverId === serverId),
    resolveAgent: async ({ serverId, agentId }) => {
      const session = useSessionStore.getState().sessions[serverId];
      const cached = session?.agents.get(agentId) ?? session?.agentDetails.get(agentId);
      if (cached)
        return { id: cached.id, workspaceId: normalizeWorkspaceOpaqueId(cached.workspaceId) };
      const snapshot = runtime.getSnapshot(serverId);
      if (!snapshot?.client || snapshot.connectionStatus !== "online")
        throw new SessionLinkError("unavailable");
      const result = await snapshot.client.fetchAgent({ agentId });
      const agent = result?.agent;
      if (!agent) return null;
      return { id: agent.id, workspaceId: normalizeWorkspaceOpaqueId(agent.workspaceId) };
    },
    navigate: ({ serverId, agentId, workspaceId }, placement) => {
      const paneId =
        placement === "side"
          ? useWorkspaceLayoutStore
              .getState()
              .ensureSidePane(`${serverId}:${workspaceId}`, { focus: true })
          : null;
      if (placement === "side" && !paneId) throw new SessionLinkError("unavailable");
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
