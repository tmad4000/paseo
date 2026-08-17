import { create } from "zustand";
import { getDesktopHost } from "@/desktop/host";

/**
 * State for the find bar (Cmd+F).
 *
 * The search itself runs in Chromium via `webContents.findInPage`, so this
 * store holds only what the bar renders: the query and the match counters that
 * arrive asynchronously on the desktop `find-in-page-result` event.
 */

export interface FindResult {
  matches: number;
  activeMatch: number;
}

interface FindState {
  isOpen: boolean;
  query: string;
  matches: number;
  activeMatch: number;
  open: () => void;
  close: () => void;
  toggle: () => void;
  setQuery: (query: string) => void;
  findNext: () => void;
  findPrevious: () => void;
  applyResult: (result: FindResult) => void;
}

function findBridge() {
  return getDesktopHost()?.find ?? null;
}

function runSearch(query: string, options: { forward: boolean; findNext: boolean }): void {
  const bridge = findBridge();
  if (!bridge) {
    return;
  }
  if (query.length === 0) {
    void bridge.stop().catch(() => {});
    return;
  }
  void bridge
    .start({ query, forward: options.forward, findNext: options.findNext })
    .catch(() => {});
}

export const useFindStore = create<FindState>((set, get) => ({
  isOpen: false,
  query: "",
  matches: 0,
  activeMatch: 0,

  open: () => {
    set({ isOpen: true });
    // Reopening with a query already typed re-runs it, so the highlights come
    // back instead of the bar showing a stale count over an unsearched page.
    const { query } = get();
    if (query.length > 0) {
      runSearch(query, { forward: true, findNext: false });
    }
  },

  close: () => {
    set({ isOpen: false, matches: 0, activeMatch: 0 });
    void findBridge()
      ?.stop({ keepSelection: true })
      ?.catch(() => {});
  },

  toggle: () => {
    if (get().isOpen) {
      get().close();
    } else {
      get().open();
    }
  },

  setQuery: (query: string) => {
    set({ query });
    if (query.length === 0) {
      set({ matches: 0, activeMatch: 0 });
    }
    // findNext:false restarts the search from the top of the document, which is
    // what every keystroke should do; findNext:true would walk forward on each
    // character typed.
    runSearch(query, { forward: true, findNext: false });
  },

  findNext: () => {
    runSearch(get().query, { forward: true, findNext: true });
  },

  findPrevious: () => {
    runSearch(get().query, { forward: false, findNext: true });
  },

  applyResult: (result: FindResult) => {
    set({ matches: result.matches, activeMatch: result.activeMatch });
  },
}));
