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

/**
 * An empty page: the user has nothing to read yet, so the address field gets focus.
 * A missing record (before the store hydrates) is not empty: the pane shows a default page.
 */
export function isEmptyBrowserPage(url: string | null | undefined): boolean {
  return typeof url === "string" && url.trim() === "about:blank";
}

/**
 * Whether the pane should move focus to its URL bar now. Only the focused, visible
 * pane may take focus; a background pane keeps any pending request until the user
 * brings it forward. An empty page takes focus only when its tab has just become visible
 * while focused, so clicking its toolbar controls keeps focus on those controls.
 */
export function shouldAutofocusBrowserUrlBar(input: {
  browserId: string;
  url: string | null | undefined;
  isInteractive: boolean;
  isPresented: boolean;
  justActivated: boolean;
}): boolean {
  if (!input.isInteractive || !input.isPresented) {
    return false;
  }
  const requested = consumeBrowserUrlBarFocus(input.browserId);
  return requested || (input.justActivated && isEmptyBrowserPage(input.url));
}
