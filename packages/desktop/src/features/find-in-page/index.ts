import { ipcMain, type WebContents } from "electron";

/**
 * Find-in-page for the desktop window.
 *
 * Chromium already implements text search over the rendered page, so this
 * delegates to `webContents.findInPage` rather than walking the DOM. Walking it
 * would mean either mutating nodes React owns, or reimplementing scroll-into-
 * view and match ordering across virtualized lists.
 *
 * Results arrive asynchronously on the `found-in-page` event, which is why the
 * renderer gets match counts pushed rather than returned from the invoke.
 */

export const FIND_RESULT_EVENT = "paseo:event:find-in-page-result";

export interface FindInPageResultPayload {
  requestId: number;
  activeMatchOrdinal: number;
  matches: number;
  finalUpdate: boolean;
}

interface StartFindInput {
  query: string;
  forward: boolean;
  findNext: boolean;
  matchCase: boolean;
}

// One `found-in-page` listener per WebContents, attached on first use. A window
// that is never searched never gets a listener.
const wiredContents = new WeakSet<WebContents>();

function ensureResultForwarding(contents: WebContents): void {
  if (wiredContents.has(contents)) {
    return;
  }
  wiredContents.add(contents);
  contents.on("found-in-page", (_event, result) => {
    if (contents.isDestroyed()) {
      return;
    }
    const payload: FindInPageResultPayload = {
      requestId: result.requestId,
      activeMatchOrdinal: result.activeMatchOrdinal,
      matches: result.matches,
      finalUpdate: result.finalUpdate,
    };
    contents.send(FIND_RESULT_EVENT, payload);
  });
}

function parseStartInput(raw: unknown): StartFindInput | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const input = raw as Record<string, unknown>;
  const query = typeof input.query === "string" ? input.query : "";
  if (query.length === 0) {
    return null;
  }
  return {
    query,
    forward: input.forward !== false,
    findNext: input.findNext === true,
    matchCase: input.matchCase === true,
  };
}

export function registerFindInPage(): void {
  ipcMain.handle("paseo:find:start", (event, raw: unknown): number | null => {
    const input = parseStartInput(raw);
    if (!input) {
      return null;
    }
    const contents = event.sender;
    if (contents.isDestroyed()) {
      return null;
    }
    ensureResultForwarding(contents);
    return contents.findInPage(input.query, {
      forward: input.forward,
      findNext: input.findNext,
      matchCase: input.matchCase,
    });
  });

  ipcMain.handle("paseo:find:stop", (event, raw: unknown): boolean => {
    const contents = event.sender;
    if (contents.isDestroyed()) {
      return false;
    }
    // Keeping the selection leaves the last match visible when the bar closes,
    // which is what every other editor does on Escape.
    const keepSelection =
      typeof raw === "object" && raw !== null
        ? (raw as Record<string, unknown>).keepSelection === true
        : false;
    contents.stopFindInPage(keepSelection ? "keepSelection" : "clearSelection");
    return true;
  });
}
