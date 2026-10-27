import { create } from "zustand";
import { threadLabels, type ThreadOrigin } from "./model";

/**
 * A "Reply in thread" draft remembers which reply it answers until its first message creates the
 * session, which then carries the link as labels. Kept beside the draft's chat-history attachment
 * (also in memory, keyed by draft id) rather than on the persisted tab target, so a saved layout
 * stays readable by builds that predate threads.
 */
interface ThreadDraftState {
  originByDraftId: Record<string, ThreadOrigin>;
  setOrigin(draftId: string, origin: ThreadOrigin): void;
  clear(draftId: string): void;
}

export const useThreadDraftStore = create<ThreadDraftState>((set) => ({
  originByDraftId: {},
  setOrigin: (draftId, origin) =>
    set((state) => ({ originByDraftId: { ...state.originByDraftId, [draftId]: origin } })),
  clear: (draftId) =>
    set((state) => {
      if (!(draftId in state.originByDraftId)) return state;
      const next = { ...state.originByDraftId };
      delete next[draftId];
      return { originByDraftId: next };
    }),
}));

/** Labels the draft's session is created with: the thread link, or none. */
export function threadLabelsForDraft(draftId: string): Record<string, string> | undefined {
  const origin = useThreadDraftStore.getState().originByDraftId[draftId];
  return origin ? threadLabels(origin) : undefined;
}
