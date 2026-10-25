/** @vitest-environment jsdom */
import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: (fn: (theme: unknown) => unknown) => fn({ spacing: { 1: 4 } }) },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => (key.endsWith("showLess") ? "Show less" : "Show more"),
  }),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onPress,
    accessibilityState,
  }: {
    children: ReactNode;
    onPress(): void;
    accessibilityState: { expanded: boolean };
  }) =>
    React.createElement(
      "button",
      { type: "button", onClick: onPress, "aria-expanded": accessibilityState.expanded },
      children,
    ),
}));
vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
import { findRenderedMatches } from "../agent-stream/chat-find/ranges.web";
import { CollapsiblePrompt } from "./collapsible-prompt";

const dataset = { messageText: "true" };
const textStyle = {};
describe("collapsible sent prompts", () => {
  let root: Root;
  let container: HTMLElement;
  beforeEach(() => {
    container = document.createElement("div");
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });
  function render(message: string, renderFullContent = false) {
    act(() => {
      root.render(
        <CollapsiblePrompt
          message={message}
          textStyle={textStyle}
          dataSet={dataset}
          renderFullContent={renderFullContent}
        />,
      );
    });
  }
  it("expands the full original text and collapses it again", () => {
    const message = "Long prompt ".repeat(100) + "END_MARKER";
    render(message);
    expect(container.textContent).not.toContain("END_MARKER");
    expect(container.textContent).toContain("…Show more");
    const button = container.querySelector("button")!;
    expect(button.getAttribute("aria-expanded")).toBe("false");
    act(() => button.click());
    expect(container.textContent).toContain(message);
    expect(button.textContent).toBe("Show less");
    expect(button.getAttribute("aria-expanded")).toBe("true");
    act(() => button.click());
    expect(container.textContent).not.toContain("END_MARKER");
  });
  it("does not show a toggle for short prompts", () => {
    render("A short prompt");
    expect(container.textContent).toBe("A short prompt");
    expect(container.querySelector("button")).toBeNull();
  });
  it("does not carry expansion into a different message in a reused row", () => {
    render("A".repeat(1000));
    act(() => container.querySelector("button")!.click());
    render("B".repeat(1000));
    expect(container.querySelector("button")?.textContent).toBe("Show more");
    expect(container.textContent).not.toContain("B".repeat(1000));
  });
  it.each([
    ["character limit", "x".repeat(500) + " UNIQUE_TAIL", "UNIQUE_TAIL", 1],
    ["line limit", "one\ntwo\nthree\nfour\nfive\nsix\nUNIQUE_TAIL", "UNIQUE_TAIL", 1],
    ["repeated matches", "NEEDLE " + "x".repeat(500) + " NEEDLE", "NEEDLE", 2],
  ])("reveals all Find matches beyond the %s", (_label, message, query, count) => {
    render(message as string);
    const before = findRenderedMatches(container, query as string).length;
    expect(before).toBeLessThan(count as number);
    render(message as string, true);
    expect(findRenderedMatches(container, query as string)).toHaveLength(count as number);
    expect(container.querySelector("button")).toBeNull();
    render(message as string, false);
    expect(findRenderedMatches(container, query as string)).toHaveLength(before);
    expect(container.querySelector("button")?.textContent).toBe("Show more");
  });
});
