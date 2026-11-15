import { describe, expect, it } from "vitest";
import {
  consumeBrowserUrlBarFocus,
  isEmptyBrowserPage,
  requestBrowserUrlBarFocus,
  shouldAutofocusBrowserUrlBar,
} from "./url-bar-autofocus";

const focusedVisible = { isInteractive: true, isPresented: true, justActivated: true };

describe("browser URL bar autofocus", () => {
  it("focuses a newly created browser once, when its pane is focused and visible", () => {
    requestBrowserUrlBarFocus("new-1");
    const input = { ...focusedVisible, browserId: "new-1", url: "https://example.com" };
    expect(shouldAutofocusBrowserUrlBar(input)).toBe(true);
    expect(shouldAutofocusBrowserUrlBar(input)).toBe(false);
  });

  it("does not take focus for a background tab and keeps the request until it is brought forward", () => {
    requestBrowserUrlBarFocus("bg-1");
    const base = { browserId: "bg-1", url: "https://example.com", justActivated: true };
    expect(shouldAutofocusBrowserUrlBar({ ...base, isInteractive: false, isPresented: true })).toBe(
      false,
    );
    expect(shouldAutofocusBrowserUrlBar({ ...base, isInteractive: true, isPresented: false })).toBe(
      false,
    );
    expect(consumeBrowserUrlBarFocus("bg-1")).toBe(true);
  });

  it("never focuses an unrequested page tab that has content", () => {
    expect(
      shouldAutofocusBrowserUrlBar({
        ...focusedVisible,
        browserId: "page-1",
        url: "https://example.com/docs",
      }),
    ).toBe(false);
  });

  it("focuses an empty page each time its tab is activated, not when its visible pane is clicked", () => {
    const input = { ...focusedVisible, browserId: "blank-1", url: "about:blank" };
    expect(shouldAutofocusBrowserUrlBar(input)).toBe(true);
    expect(shouldAutofocusBrowserUrlBar(input)).toBe(true);
    expect(shouldAutofocusBrowserUrlBar({ ...input, justActivated: false })).toBe(false);
    expect(shouldAutofocusBrowserUrlBar({ ...input, isInteractive: false })).toBe(false);
  });

  it.each([
    ["about:blank", true],
    [" about:blank ", true],
    ["", false],
    [null, false],
    [undefined, false],
    ["https://example.com", false],
  ])("treats %j as empty=%s", (url, expected) => {
    expect(isEmptyBrowserPage(url)).toBe(expected);
  });
});
