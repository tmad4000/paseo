import { create } from "zustand";

type AgentView = "chat" | "artifacts";

interface AgentViewStoreState {
  selectedViews: Record<string, AgentView>;
  /** Find is an overlay on Chat, not a sibling view, so it is tracked separately. */
  findOpen: Record<string, boolean>;
  setSelectedView: (serverId: string, agentId: string, view: AgentView) => void;
  getSelectedView: (serverId: string, agentId: string) => AgentView;
  setFindOpen: (serverId: string, agentId: string, open: boolean) => void;
}

export const useAgentViewStore = create<AgentViewStoreState>()((set, get) => ({
  selectedViews: {},
  findOpen: {},
  setSelectedView: (serverId, agentId, view) => {
    set((state) => ({
      selectedViews: {
        ...state.selectedViews,
        [`${serverId}:${agentId}`]: view,
      },
    }));
  },
  getSelectedView: (serverId, agentId) => {
    return get().selectedViews[`${serverId}:${agentId}`] || "chat";
  },
  setFindOpen: (serverId, agentId, open) => {
    set((state) => ({
      findOpen: {
        ...state.findOpen,
        [`${serverId}:${agentId}`]: open,
      },
    }));
  },
}));
