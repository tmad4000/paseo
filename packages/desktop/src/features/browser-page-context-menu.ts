import type { MenuItemConstructorOptions } from "electron";

import { canOpenExternally } from "./opener.js";

/**
 * Items that act on the in-app browser page itself, shown at the top of the page's
 * right-click menu. "Open Page in Browser" opens the current page in the system
 * default browser and is disabled for about:blank, file:, data: and other non-web pages.
 */
export function buildBrowserPageContextMenuItems(input: {
  pageUrl: string;
  openExternal: (url: string) => Promise<void>;
  onError?: (error: unknown) => void;
}): MenuItemConstructorOptions[] {
  const { pageUrl, openExternal, onError } = input;
  return [
    {
      id: "browser-open-page-externally",
      label: "Open Page in Browser",
      enabled: canOpenExternally(pageUrl),
      click: () => {
        void openExternal(pageUrl).catch((error: unknown) => {
          onError?.(error);
        });
      },
    },
    { type: "separator" },
  ];
}
