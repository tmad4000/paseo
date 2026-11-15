import { isHttpUrl } from "@/utils/http-url";

export type OpenBrowserPageExternallyResult = "opened" | "unsupported" | "failed";

/**
 * Returns the browser tab's page URL when the system browser may open it.
 * Pages such as about:blank, file: and data: URLs stay inside Paseo.
 */
export function resolveExternalBrowserPageUrl(url: string | null | undefined): string | null {
  if (typeof url !== "string") {
    return null;
  }
  const trimmed = url.trim();
  return trimmed.length > 0 && isHttpUrl(trimmed) ? trimmed : null;
}

/**
 * Opens a browser tab's current page in the system default browser. The opener
 * is injected so the pane passes `openExternalUrl` (Electron shell.openExternal,
 * window.open on web, Linking on native) and tests pass a recorder.
 */
export async function openBrowserPageExternally(input: {
  url: string | null | undefined;
  open: (url: string) => Promise<void>;
}): Promise<OpenBrowserPageExternallyResult> {
  const url = resolveExternalBrowserPageUrl(input.url);
  if (!url) {
    return "unsupported";
  }
  try {
    await input.open(url);
    return "opened";
  } catch (error) {
    console.warn("[browser-pane] open in system browser failed", error);
    return "failed";
  }
}
