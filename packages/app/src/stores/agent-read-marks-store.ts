import { create } from "zustand";

/**
 * The activity timestamp each agent was explicitly read through on this device: by its
 * mark-as-read control or by sending it a prompt. Tab unread dots are local and in-memory, so
 * this is what lets a read made from a tab, the sidebar or the composer reach every tab strip
 * showing that agent. Activity after the mark makes the tab unread again.
 */
interface AgentReadMarksState {
  readThroughByAgentKey: Map<string, number>;
  markReadThrough: (input: { serverId: string; agentId: string; activityAt: number }) => void;
}

export function agentReadMarkKey(serverId: string, agentId: string): string {
  return `${serverId}:${agentId}`;
}

export const useAgentReadMarksStore = create<AgentReadMarksState>()((set) => ({
  readThroughByAgentKey: new Map(),
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
}));
