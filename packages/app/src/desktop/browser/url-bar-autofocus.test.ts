import { describe, expect, it } from "vitest";
import {
  consumeBrowserUrlBarFocus,
  isEmptyBrowserPage,
  requestBrowserUrlBarFocus,
  shouldAutofocusBrowserUrlBar,
} from "./url-bar-autofocus";

describe("browser URL bar autofocus", () => {
  it("focuses a newly created browser once, when its pane is focused and visible", () => {
    requestBrowserUrlBarFocus("new-1");
    const input = {
      browserId: "new-1",
      url: "https://example.com",
      isInteractive: true,
      isPresented: true,
    };
    expect(shouldAutofocusBrowserUrlBar(input)).toBe(true);
    expect(shouldAutofocusBrowserUrlBar(input)).toBe(false);
  });

  it("does not take focus for a background tab and keeps the request until it is brought forward", () => {
    requestBrowserUrlBarFocus("bg-1");
    expect(
      shouldAutofocusBrowserUrlBar({
        browserId: "bg-1",
        url: "https://example.com",
        isInteractive: false,
        isPresented: true,
      }),
    ).toBe(false);
    expect(
      shouldAutofocusBrowserUrlBar({
        browserId: "bg-1",
        url: "https://example.com",
        isInteractive: true,
        isPresented: false,
      }),
    ).toBe(false);
    expect(consumeBrowserUrlBarFocus("bg-1")).toBe(true);
  });

  it("never focuses an unrequested page tab that has content", () => {
    expect(
      shouldAutofocusBrowserUrlBar({
        browserId: "page-1",
        url: "https://example.com/docs",
        isInteractive: true,
        isPresented: true,
      }),
    ).toBe(false);
  });

  it("focuses an empty page whenever it becomes the focused, visible tab", () => {
    const input = {
      browserId: "blank-1",
      url: "about:blank",
      isInteractive: true,
      isPresented: true,
    };
    expect(shouldAutofocusBrowserUrlBar(input)).toBe(true);
    expect(shouldAutofocusBrowserUrlBar(input)).toBe(true);
    expect(shouldAutofocusBrowserUrlBar({ ...input, isInteractive: false })).toBe(false);
  });

  it.each([
    ["", true],
    ["  ", true],
    [null, true],
    ["about:blank", true],
    ["https://example.com", false],
  ])("treats %j as empty=%s", (url, expected) => {
    expect(isEmptyBrowserPage(url)).toBe(expected);
  });
});
