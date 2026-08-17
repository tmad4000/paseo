export interface FindMatchSummary {
  matches: number;
}

export interface FindHighlighter {
  /** Highlights every occurrence of `query` and returns how many were found. */
  search: (query: string) => number;
  /** Marks one match as active and scrolls it into view. Index is 0-based. */
  focusMatch: (index: number) => void;
  /** Removes all highlights. */
  clear: () => void;
}

const NOOP_HIGHLIGHTER: FindHighlighter = {
  search: () => 0,
  focusMatch: () => {},
  clear: () => {},
};

export function getFindHighlighter(): FindHighlighter {
  return NOOP_HIGHLIGHTER;
}
