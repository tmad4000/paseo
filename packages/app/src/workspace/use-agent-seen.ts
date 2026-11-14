import { useCallback } from "react";
import { useSettings } from "@/hooks/use-settings";
import { agentReadMarkKey, useAgentReadMarksStore } from "@/stores/agent-read-marks-store";
import { useSessionStore } from "@/stores/session-store";
import { hasClearableAgentAttention, readAgentSeenClock } from "@/workspace/mark-read";

type SessionStoreSnapshot = ReturnType<typeof useSessionStore.getState>;

function isAgentSeenNotRead(
  state: SessionStoreSnapshot,
  seenThroughByAgentKey: ReadonlyMap<string, number>,
  serverId: string,
  agentId: string,
): boolean {
  const agent = state.sessions[serverId]?.agents?.get(agentId);
  if (!hasClearableAgentAttention(agent)) return false;
  const seenThrough = seenThroughByAgentKey.get(agentReadMarkKey(serverId, agentId)) ?? 0;
  return seenThrough > 0 && seenThrough >= readAgentSeenClock(state, serverId, agentId);
}

/**
 * Whether this chat's readable host attention has been looked at on this device but not read:
 * the sidebar's ring, matching the tab strip's. False in the legacy read-on-open mode.
 */
export function useAgentSeenNotRead(serverId: string, agentId: string): boolean {
  const viewingMarksRead = useSettings((settings) => settings.markReadOnOpen);
  const seenThroughByAgentKey = useAgentReadMarksStore((state) => state.seenThroughByAgentKey);
  return useSessionStore(
    useCallback(
      (state) =>
        !viewingMarksRead && isAgentSeenNotRead(state, seenThroughByAgentKey, serverId, agentId),
      [agentId, seenThroughByAgentKey, serverId, viewingMarksRead],
    ),
  );
}

/**
 * A workspace row's version: it has readable attention, and every chat carrying it has been
 * seen. One chat that has not been looked at keeps the row's badge filled.
 */
export function useWorkspaceSeenNotRead(serverId: string, workspaceId: string): boolean {
  const viewingMarksRead = useSettings((settings) => settings.markReadOnOpen);
  const seenThroughByAgentKey = useAgentReadMarksStore((state) => state.seenThroughByAgentKey);
  return useSessionStore(
    useCallback(
      (state) => {
        if (viewingMarksRead || seenThroughByAgentKey.size === 0) return false;
        const agents = state.sessions[serverId]?.agents;
        if (!agents) return false;
        let attention = 0;
        for (const agent of agents.values()) {
          if (agent.workspaceId !== workspaceId || !hasClearableAgentAttention(agent)) continue;
          if (!isAgentSeenNotRead(state, seenThroughByAgentKey, serverId, agent.id)) return false;
          attention += 1;
        }
        return attention > 0;
      },
      [seenThroughByAgentKey, serverId, viewingMarksRead, workspaceId],
    ),
  );
}
