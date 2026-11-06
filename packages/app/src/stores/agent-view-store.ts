import { create } from "zustand";
import type { ChatJumpTarget } from "@/agent-stream/use-timeline-anchor-jump";

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

/** A request to show Chat scrolled to where a Stream entry came from. */
export interface ChatJumpRequest {
  target: ChatJumpTarget;
  /** Distinguishes repeated requests for the same place. */
  requestId: number;
}

let nextChatJumpRequestId = 0;

/** A request to quote a Stream entry into the chat's composer and focus it. */
export interface ReplyQuoteRequest {
  text: string;
  requestId: number;
}

let nextReplyQuoteRequestId = 0;

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
  chatJump: Record<string, ChatJumpRequest>;
  /** Switches the chat to Chat and asks it to scroll to the target, once its history is ready. */
  openChatAt: (serverId: string, agentId: string, target: ChatJumpTarget) => void;
  /** Chat calls this once it has applied the request. */
  clearChatJump: (serverId: string, agentId: string, requestId: number) => void;
  replyQuote: Record<string, ReplyQuoteRequest>;
  /**
   * Switches the chat to Chat and asks its composer to quote the text above the draft and take
   * focus, once the draft has loaded. Works whether or not that chat is open yet.
   */
  requestReplyQuote: (serverId: string, agentId: string, text: string) => void;
  /** The chat panel calls this once it has applied the request. */
  clearReplyQuote: (serverId: string, agentId: string, requestId: number) => void;
}

export const useAgentViewStore = create<AgentViewStoreState>()((set, get) => ({
  selectedViews: {},
  findOpen: {},
  streamFocus: {},
  chatJump: {},
  replyQuote: {},
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
  openChatAt: (serverId, agentId, target) => {
    const key = `${serverId}:${agentId}`;
    nextChatJumpRequestId += 1;
    set((state) => ({
      selectedViews: { ...state.selectedViews, [key]: "chat" },
      chatJump: { ...state.chatJump, [key]: { target, requestId: nextChatJumpRequestId } },
    }));
  },
  clearChatJump: (serverId, agentId, requestId) => {
    const key = `${serverId}:${agentId}`;
    set((state) => {
      if (state.chatJump[key]?.requestId !== requestId) return state;
      const { [key]: _cleared, ...rest } = state.chatJump;
      return { chatJump: rest };
    });
  },
  requestReplyQuote: (serverId, agentId, text) => {
    const key = `${serverId}:${agentId}`;
    nextReplyQuoteRequestId += 1;
    set((state) => ({
      selectedViews: { ...state.selectedViews, [key]: "chat" },
      replyQuote: { ...state.replyQuote, [key]: { text, requestId: nextReplyQuoteRequestId } },
    }));
  },
  clearReplyQuote: (serverId, agentId, requestId) => {
    const key = `${serverId}:${agentId}`;
    set((state) => {
      if (state.replyQuote[key]?.requestId !== requestId) return state;
      const { [key]: _cleared, ...rest } = state.replyQuote;
      return { replyQuote: rest };
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
