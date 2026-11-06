import { create } from "zustand";

/**
 * The activity timestamp each agent was explicitly read through on this device: by its
 * mark-as-read control or by sending it a prompt. Tab unread dots are local and in-memory, so
 * this is what lets a read made from a tab, the sidebar or the composer reach every tab strip
 * showing that agent. Activity after the mark makes the tab unread again.
 *
 * Next to it, the clock each agent was *seen* through: its tab sat on screen long enough to be
 * looked at (see `TAB_SEEN_DWELL_MS`). Seen is weaker than read — it only turns a tab's filled
 * "new activity" badge into a hollow ring and never clears host attention. The seen clock is the
 * later of the agent's activity and its attention timestamp (`agentSeenClock`), so a fresh
 * finish or a "Mark as unread" (which stamps new attention) makes the badge filled again.
 */
interface AgentReadMarksState {
  readThroughByAgentKey: Map<string, number>;
  seenThroughByAgentKey: Map<string, number>;
  markReadThrough: (input: { serverId: string; agentId: string; activityAt: number }) => void;
  markSeenThrough: (input: { serverId: string; agentId: string; seenAt: number }) => void;
  clearSeen: (input: { serverId: string; agentId: string }) => void;
}

export function agentReadMarkKey(serverId: string, agentId: string): string {
  return `${serverId}:${agentId}`;
}

export const useAgentReadMarksStore = create<AgentReadMarksState>()((set) => ({
  readThroughByAgentKey: new Map(),
  seenThroughByAgentKey: new Map(),
  markReadThrough: ({ serverId, agentId, activityAt }) =>
    set((state) => {
      const key = agentReadMarkKey(serverId, agentId);
      // Never 0: a mark through "no activity" must still beat a tab that has none recorded yet.
      const readThrough = Math.max(activityAt, 1);
      if ((state.readThroughByAgentKey.get(key) ?? 0) >= readThrough) return state;
      const next = new Map(state.readThroughByAgentKey);
      next.set(key, readThrough);
      return { readThroughByAgentKey: next };
    }),
  markSeenThrough: ({ serverId, agentId, seenAt }) =>
    set((state) => {
      const key = agentReadMarkKey(serverId, agentId);
      const seenThrough = Math.max(seenAt, 1);
      if ((state.seenThroughByAgentKey.get(key) ?? 0) >= seenThrough) return state;
      const next = new Map(state.seenThroughByAgentKey);
      next.set(key, seenThrough);
      return { seenThroughByAgentKey: next };
    }),
  clearSeen: ({ serverId, agentId }) =>
    set((state) => {
      const key = agentReadMarkKey(serverId, agentId);
      if (!state.seenThroughByAgentKey.has(key)) return state;
      const next = new Map(state.seenThroughByAgentKey);
      next.delete(key);
      return { seenThroughByAgentKey: next };
    }),
}));
