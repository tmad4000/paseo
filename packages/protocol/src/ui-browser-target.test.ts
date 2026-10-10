import { describe, expect, it } from "vitest";
import { BrowserAutomationBrowserIdSchema } from "./browser-automation/rpc-schemas.js";
import { browserIdForUrl, normalizeUiBrowserUrl } from "./ui-browser-target.js";

describe("browserIdForUrl", () => {
  it("is a valid browser id, stable per URL and distinct across URLs", () => {
    const m4 = browserIdForUrl("https://m4-mini.tailb2a35c.ts.net:8047/m4-checklist.html");
    const general = browserIdForUrl(
      "https://m4-mini.tailb2a35c.ts.net:8047/general-checklist.html",
    );
    expect(BrowserAutomationBrowserIdSchema.safeParse(m4).success).toBe(true);
    expect(BrowserAutomationBrowserIdSchema.safeParse(general).success).toBe(true);
    expect(browserIdForUrl("https://m4-mini.tailb2a35c.ts.net:8047/m4-checklist.html")).toBe(m4);
    expect(general).not.toBe(m4);
  });
});

describe("normalizeUiBrowserUrl", () => {
  it("accepts absolute http(s) only", () => {
    expect(normalizeUiBrowserUrl(" https://example.com/a ")).toBe("https://example.com/a");
    expect(normalizeUiBrowserUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUiBrowserUrl("data:text/html,x")).toBeNull();
    expect(normalizeUiBrowserUrl("example.com")).toBeNull();
    expect(normalizeUiBrowserUrl(undefined)).toBeNull();
  });
});
