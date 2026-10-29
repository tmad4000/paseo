import { create } from "zustand";

type AgentView = "chat" | "artifacts";

/** A request to show one Stream entry's card: the Tasks view, searched down to it. */
export interface StreamFocusRequest {
  entryId: string;
  /** Text the entry contains, used as the Stream search. */
  query: string;
  /** Distinguishes repeated requests for the same entry. */
  requestId: number;
}

let nextStreamFocusRequestId = 0;

interface AgentViewStoreState {
  selectedViews: Record<string, AgentView>;
  /** Find is an overlay on Chat, not a sibling view, so it is tracked separately. */
  findOpen: Record<string, boolean>;
  setSelectedView: (serverId: string, agentId: string, view: AgentView) => void;
  getSelectedView: (serverId: string, agentId: string) => AgentView;
  setFindOpen: (serverId: string, agentId: string, open: boolean) => void;
  streamFocus: Record<string, StreamFocusRequest>;
  /** Switches the chat to its Stream and asks the Stream to show the entry's card. */
  openStreamEntry: (
    serverId: string,
    agentId: string,
    entry: { entryId: string; query: string },
  ) => void;
  /** The Stream calls this once it has applied the request. */
  clearStreamFocus: (serverId: string, agentId: string, requestId: number) => void;
}

export const useAgentViewStore = create<AgentViewStoreState>()((set, get) => ({
  selectedViews: {},
  findOpen: {},
  streamFocus: {},
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
  openStreamEntry: (serverId, agentId, entry) => {
    const key = `${serverId}:${agentId}`;
    nextStreamFocusRequestId += 1;
    set((state) => ({
      selectedViews: { ...state.selectedViews, [key]: "artifacts" },
      streamFocus: {
        ...state.streamFocus,
        [key]: { ...entry, requestId: nextStreamFocusRequestId },
      },
    }));
  },
  clearStreamFocus: (serverId, agentId, requestId) => {
    const key = `${serverId}:${agentId}`;
    set((state) => {
      if (state.streamFocus[key]?.requestId !== requestId) return state;
      const { [key]: _cleared, ...rest } = state.streamFocus;
      return { streamFocus: rest };
    });
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
