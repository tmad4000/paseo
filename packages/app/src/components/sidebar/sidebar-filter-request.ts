import { create } from "zustand";
import { usePanelStore } from "@/stores/panel-store";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";

/**
 * A one-shot request from outside the sidebar to put text in its find field — the command
 * center's "Search messages for …". The model applies the query; the find field replaces its
 * text and takes focus once per request id, so remounting the sidebar does not steal focus again.
 */
export interface SidebarFilterRequest {
  id: number;
  query: string;
}

interface SidebarFilterRequestState {
  request: SidebarFilterRequest | null;
  /** The last request id the find field has already focused. */
  focusedRequestId: number;
  requestSidebarFilter: (query: string) => void;
  markFocused: (id: number) => void;
}

export const useSidebarFilterRequestStore = create<SidebarFilterRequestState>()((set) => ({
  request: null,
  focusedRequestId: 0,
  requestSidebarFilter: (query) =>
    set((state) => ({ request: { id: (state.request?.id ?? 0) + 1, query } })),
  markFocused: (id) => set({ focusedRequestId: id }),
}));

/** Open the left sidebar's filter on `query`, searching names and message text. */
export function openSidebarMessageSearch(query: string, layout: { isCompact: boolean }): void {
  useSidebarViewStore.getState().setFilterScope("messages");
  usePanelStore.getState().openAgentListForLayout(layout);
  useSidebarFilterRequestStore.getState().requestSidebarFilter(query);
}
