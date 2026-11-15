import { describe, expect, it, vi } from "vitest";
import { openBrowserPageExternally, resolveExternalBrowserPageUrl } from "./open-external";

describe("resolveExternalBrowserPageUrl", () => {
  it.each(["https://example.com/docs?q=1#top", "http://localhost:8081/"])(
    "allows the http(s) page %s",
    (url) => {
      expect(resolveExternalBrowserPageUrl(url)).toBe(url);
    },
  );

  it("trims surrounding whitespace", () => {
    expect(resolveExternalBrowserPageUrl("  https://example.com/  ")).toBe("https://example.com/");
  });

  it.each([
    null,
    undefined,
    "",
    "about:blank",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,hi",
    "chrome://settings",
    "not a url",
  ])("keeps %s inside Paseo", (url) => {
    expect(resolveExternalBrowserPageUrl(url)).toBeNull();
  });
});

describe("openBrowserPageExternally", () => {
  it("opens the current http(s) page with the system opener", async () => {
    const opened: string[] = [];
    const result = await openBrowserPageExternally({
      url: "https://example.com/page",
      open: async (url) => {
        opened.push(url);
      },
    });
    expect(result).toBe("opened");
    expect(opened).toEqual(["https://example.com/page"]);
  });

  it("does not call the opener for a non-http page", async () => {
    const opened: string[] = [];
    const result = await openBrowserPageExternally({
      url: "file:///Users/me/secret.txt",
      open: async (url) => {
        opened.push(url);
      },
    });
    expect(result).toBe("unsupported");
    expect(opened).toEqual([]);
  });

  it("reports a failure when the opener rejects", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await openBrowserPageExternally({
      url: "https://example.com/",
      open: async () => {
        throw new Error("no handler");
      },
    });
    expect(result).toBe("failed");
    warn.mockRestore();
  });
});
