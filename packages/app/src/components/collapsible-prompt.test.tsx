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
  function render(message: string) {
    act(() => {
      root.render(<CollapsiblePrompt message={message} textStyle={textStyle} dataSet={dataset} />);
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
});
