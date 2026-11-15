/**
 * One-shot requests to focus a browser tab's URL bar the first time its pane is the
 * focused, visible one. The user's own "New browser" actions request it so they can
 * type an address immediately. Tabs opened in the background (`--no-focus`, `--side`)
 * or by a page or agent with a URL are not requested, so they never take focus.
 */
const pendingUrlBarFocus = new Set<string>();

export function requestBrowserUrlBarFocus(browserId: string): void {
  pendingUrlBarFocus.add(browserId);
}

/** Returns true once for a requested browser, then forgets the request. */
export function consumeBrowserUrlBarFocus(browserId: string): boolean {
  return pendingUrlBarFocus.delete(browserId);
}

/** An empty page: the user has nothing to read yet, so the address field gets focus. */
export function isEmptyBrowserPage(url: string | null | undefined): boolean {
  const trimmed = typeof url === "string" ? url.trim() : "";
  return trimmed.length === 0 || trimmed === "about:blank";
}

/**
 * Whether the pane should move focus to its URL bar now. Only the focused, visible
 * pane may take focus; a background pane keeps any pending request until the user
 * brings it forward.
 */
export function shouldAutofocusBrowserUrlBar(input: {
  browserId: string;
  url: string | null | undefined;
  isInteractive: boolean;
  isPresented: boolean;
}): boolean {
  if (!input.isInteractive || !input.isPresented) {
    return false;
  }
  const requested = consumeBrowserUrlBarFocus(input.browserId);
  return requested || isEmptyBrowserPage(input.url);
}
