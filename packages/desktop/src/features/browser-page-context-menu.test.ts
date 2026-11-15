import { describe, expect, it } from "vitest";

import { buildBrowserPageContextMenuItems } from "./browser-page-context-menu";
import { createExternalUrlOpener } from "./opener";

function buildItems(pageUrl: string) {
  const opened: string[] = [];
  const errors: unknown[] = [];
  const items = buildBrowserPageContextMenuItems({
    pageUrl,
    openExternal: createExternalUrlOpener({
      open: async (url) => {
        opened.push(url);
      },
    }),
    onError: (error) => errors.push(error),
  });
  return { items, opened, errors };
}

describe("browser page context menu", () => {
  it("opens the current http(s) page in the system browser", async () => {
    const { items, opened } = buildItems("https://example.com/docs?q=1#top");
    const [openItem, separator] = items;

    expect(openItem?.label).toBe("Open Page in Browser");
    expect(openItem?.enabled).toBe(true);
    expect(separator?.type).toBe("separator");

    openItem?.click?.({} as never, undefined, {} as never);
    await Promise.resolve();
    await Promise.resolve();

    expect(opened).toEqual(["https://example.com/docs?q=1#top"]);
  });

  it.each(["about:blank", "file:///private/data", "data:text/html,hi", "javascript:alert(1)", ""])(
    "disables the item and never opens %s",
    async (pageUrl) => {
      const { items, opened } = buildItems(pageUrl);
      const [openItem] = items;

      expect(openItem?.enabled).toBe(false);

      openItem?.click?.({} as never, undefined, {} as never);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(opened).toEqual([]);
    },
  );
});
