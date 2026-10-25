import { useMemo, useSyncExternalStore } from "react";
import { joinSubtitleParts } from "@/command-center/results";
import { useRecentVisitsStore } from "@/stores/recent-visits-store";
import { useSessionStore } from "@/stores/session-store";
import { selectWorkspace } from "@/stores/session-store-hooks/selectors";
import { navigationFocusHistory } from "./focus-history";
import { buildRecentSessionRows, type RecentSessionRow } from "./recent-sessions";
import { recentSessionsFromVisits } from "./recent-workspaces";

/** The agent session on screen, if focus is on one. */
export function useFocusedAgent(): { serverId: string; agentId: string } | null {
  const current = useSyncExternalStore(
    navigationFocusHistory.subscribe,
    () => navigationFocusHistory.getSnapshot().current,
    () => navigationFocusHistory.getSnapshot().current,
  );
  return useMemo(
    () =>
      current?.kind === "workspace" && current.target?.kind === "agent"
        ? { serverId: current.serverId, agentId: current.target.agentId }
        : null,
    [current],
  );
}

/**
 * Recent sessions with live titles and status. Subscribes to the whole session store,
 * so mount it only inside surfaces that are open (a menu's content, Cmd+K).
 */
export function useRecentSessionRows(limit?: number): RecentSessionRow[] {
  const visits = useRecentVisitsStore((state) => state.visits);
  const sessions = useSessionStore((state) => state.sessions);
  const current = useFocusedAgent();

  return useMemo(
    () =>
      buildRecentSessionRows({
        sessions: recentSessionsFromVisits(visits),
        current,
        limit,
        agentInfo: (serverId, agentId) => {
          const agent = sessions[serverId]?.agents.get(agentId);
          if (!agent) return null;
          return {
            title: agent.title,
            provider: agent.provider,
            status: agent.status,
            requiresAttention: Boolean(agent.requiresAttention),
            attentionReason: agent.attentionReason ?? null,
            pendingPermissionCount: agent.pendingPermissions.length,
            archived: Boolean(agent.archivedAt),
          };
        },
        breadcrumb: (serverId, workspaceId) => {
          const workspace = selectWorkspace({ sessions }, serverId, workspaceId);
          return workspace
            ? joinSubtitleParts([
                workspace.projectCustomName ?? workspace.projectDisplayName,
                workspace.title ?? workspace.name,
              ])
            : "";
        },
      }),
    [current, limit, sessions, visits],
  );
}
