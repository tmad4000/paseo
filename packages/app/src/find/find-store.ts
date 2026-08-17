import { create } from "zustand";
import { getFindHighlighter } from "@/find/find-highlighter";

/**
 * State for the find bar (Cmd+F).
 *
 * Matching runs in the renderer through the CSS Custom Highlight API — see
 * find-highlighter.web.ts for why `webContents.findInPage` is unusable here.
 * That keeps the counts synchronous, so the bar never renders a stale count.
 */

/**
 * Typing re-scans the document, so a keystroke-per-scan makes a long transcript
 * feel laggy. One scan per pause is indistinguishable to the user.
 */
const SEARCH_DEBOUNCE_MS = 120;

interface FindState {
  isOpen: boolean;
  query: string;
  matches: number;
  /** 0-based index into the match list; -1 when there is nothing to step to. */
  activeIndex: number;
  open: () => void;
  close: () => void;
  toggle: () => void;
  setQuery: (query: string) => void;
  findNext: () => void;
  findPrevious: () => void;
  /** Runs the pending search immediately. Exposed for tests. */
  flushSearch: () => void;
}

let debounceHandle: ReturnType<typeof setTimeout> | null = null;

function cancelPendingSearch(): void {
  if (debounceHandle !== null) {
    clearTimeout(debounceHandle);
    debounceHandle = null;
  }
}

export const useFindStore = create<FindState>((set, get) => {
  function runSearch(query: string): void {
    cancelPendingSearch();
    const highlighter = getFindHighlighter();
    if (query.length === 0) {
      highlighter.clear();
      set({ matches: 0, activeIndex: -1 });
      return;
    }
    const matches = highlighter.search(query);
    set({ matches, activeIndex: matches > 0 ? 0 : -1 });
  }

  function step(delta: number): void {
    // A pending debounce means the counts on screen predate the current query;
    // settle it first so stepping moves within the right match list.
    if (debounceHandle !== null) {
      runSearch(get().query);
    }
    const { matches, activeIndex } = get();
    if (matches === 0) {
      return;
    }
    // Wrap around, matching every other find bar.
    const next = (activeIndex + delta + matches) % matches;
    set({ activeIndex: next });
    getFindHighlighter().focusMatch(next);
  }

  return {
    isOpen: false,
    query: "",
    matches: 0,
    activeIndex: -1,

    open: () => {
      set({ isOpen: true });
      // Reopening with a query already typed re-runs it, so highlights come
      // back instead of the bar showing a count over an unhighlighted page.
      const { query } = get();
      if (query.length > 0) {
        runSearch(query);
      }
    },

    close: () => {
      cancelPendingSearch();
      getFindHighlighter().clear();
      set({ isOpen: false, matches: 0, activeIndex: -1 });
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
      cancelPendingSearch();
      if (query.length === 0) {
        runSearch("");
        return;
      }
      debounceHandle = setTimeout(() => {
        debounceHandle = null;
        runSearch(get().query);
      }, SEARCH_DEBOUNCE_MS);
    },

    findNext: () => step(1),
    findPrevious: () => step(-1),

    flushSearch: () => {
      if (debounceHandle !== null) {
        runSearch(get().query);
      }
    },
  };
});
