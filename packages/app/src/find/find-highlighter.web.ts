import type { FindHighlighter } from "@/find/find-highlighter";

/**
 * Find-in-page highlighting via the CSS Custom Highlight API.
 *
 * The obvious implementation, `webContents.findInPage`, cannot be used here.
 * Chromium's find controller moves the *document selection* onto each match,
 * and a document selection outside a focused input necessarily blurs it — so
 * the find bar's own text field loses focus on the first keystroke
 * (electron/electron#22880). Native browser find bars dodge this by living in
 * browser chrome, outside the page. Ours is inside the page, so it cannot.
 *
 * `CSS.highlights` paints ranges without touching the selection and without
 * mutating the DOM, which keeps both focus and React's ownership of the tree
 * intact.
 */

const STYLE_ID = "paseo-find-highlight-styles";
const HIGHLIGHT_ALL = "paseo-find";
const HIGHLIGHT_ACTIVE = "paseo-find-active";

/** A pathological query ("e") on a long transcript should not walk forever. */
const MAX_MATCHES = 1000;

const SKIPPED_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT"]);

/** Marks the find bar itself so its own text is never a match. */
export const FIND_BAR_DOM_ATTRIBUTE = "data-paseo-find-bar";

let ranges: Range[] = [];

function highlightsSupported(): boolean {
  return typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight === "function";
}

function installStyles(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  // Highlight pseudo-elements only accept a narrow set of properties; colour is
  // all that is portable here.
  style.textContent = `
::highlight(${HIGHLIGHT_ALL}) {
  background-color: #f59e0b66;
  color: inherit;
}

::highlight(${HIGHLIGHT_ACTIVE}) {
  background-color: #f59e0b;
  color: #1c1917;
}
`;
  document.head.append(style);
}

function shouldSkip(node: Text): boolean {
  const parent = node.parentElement;
  if (!parent) {
    return true;
  }
  if (SKIPPED_TAGS.has(parent.tagName)) {
    return true;
  }
  if (parent.closest(`[${FIND_BAR_DOM_ATTRIBUTE}]`)) {
    return true;
  }
  // A zero-height offsetParent-less element is display:none or detached. This
  // is a cheap proxy that avoids getComputedStyle on every text node.
  if (parent.offsetParent === null && parent.tagName !== "BODY") {
    return true;
  }
  return false;
}

function collectRanges(query: string): Range[] {
  const needle = query.toLowerCase();
  const found: Range[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);

  let node = walker.nextNode() as Text | null;
  while (node) {
    if (!shouldSkip(node)) {
      const haystack = node.data.toLowerCase();
      let from = haystack.indexOf(needle);
      while (from !== -1) {
        const range = document.createRange();
        range.setStart(node, from);
        range.setEnd(node, from + needle.length);
        found.push(range);
        if (found.length >= MAX_MATCHES) {
          return found;
        }
        from = haystack.indexOf(needle, from + needle.length);
      }
    }
    node = walker.nextNode() as Text | null;
  }
  return found;
}

function nearestScrollableAncestor(element: Element): Element | null {
  let current: Element | null = element;
  while (current && current !== document.body) {
    const style = getComputedStyle(current);
    const overflowY = style.overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      current.scrollHeight > current.clientHeight
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

/**
 * Scrolls a range into view without mutating the DOM. `scrollIntoView` needs an
 * element, and inserting a marker element would hand React a node it does not
 * own, so this adjusts the scroll container by the measured delta instead.
 */
function scrollRangeIntoView(range: Range): void {
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    return;
  }
  const element = range.startContainer.parentElement;
  if (!element) {
    return;
  }
  const container = nearestScrollableAncestor(element);

  if (container) {
    const containerRect = container.getBoundingClientRect();
    const isVisible = rect.top >= containerRect.top && rect.bottom <= containerRect.bottom;
    if (isVisible) {
      return;
    }
    const delta = rect.top - containerRect.top - containerRect.height / 2 + rect.height / 2;
    container.scrollBy({ top: delta, behavior: "auto" });
    return;
  }

  const isVisible = rect.top >= 0 && rect.bottom <= window.innerHeight;
  if (isVisible) {
    return;
  }
  window.scrollBy({ top: rect.top - window.innerHeight / 2 + rect.height / 2, behavior: "auto" });
}

function applyHighlights(active: number): void {
  if (!highlightsSupported()) {
    return;
  }
  if (ranges.length === 0) {
    CSS.highlights.delete(HIGHLIGHT_ALL);
    CSS.highlights.delete(HIGHLIGHT_ACTIVE);
    return;
  }
  CSS.highlights.set(HIGHLIGHT_ALL, new Highlight(...ranges));
  const activeRange = ranges[active];
  if (activeRange) {
    CSS.highlights.set(HIGHLIGHT_ACTIVE, new Highlight(activeRange));
  } else {
    CSS.highlights.delete(HIGHLIGHT_ACTIVE);
  }
}

const highlighter: FindHighlighter = {
  search: (query: string): number => {
    if (!highlightsSupported()) {
      return 0;
    }
    installStyles();
    ranges = query.length > 0 ? collectRanges(query) : [];
    applyHighlights(0);
    if (ranges[0]) {
      scrollRangeIntoView(ranges[0]);
    }
    return ranges.length;
  },

  focusMatch: (index: number): void => {
    const range = ranges[index];
    if (!range) {
      return;
    }
    applyHighlights(index);
    scrollRangeIntoView(range);
  },

  clear: (): void => {
    ranges = [];
    if (highlightsSupported()) {
      CSS.highlights.delete(HIGHLIGHT_ALL);
      CSS.highlights.delete(HIGHLIGHT_ACTIVE);
    }
  },
};

export function getFindHighlighter(): FindHighlighter {
  return highlighter;
}
