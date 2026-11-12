/* Test fixtures are intentionally declared inline for readability. */
/* oxlint-disable react-perf/jsx-no-new-object-as-prop, react-perf/jsx-no-jsx-as-prop */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { within } from "@testing-library/dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SelectableLinkText } from "./selectable-link-text";
import { QuestionFormCard } from "./question-form-card";
import { i18n as testI18n } from "@/i18n/i18next";

void testI18n;
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  window.getSelection()?.removeAllRanges();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
});
function render(node: React.ReactNode) {
  act(() => root.render(node));
  return within(container);
}
function select(node: Node) {
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return selection.toString();
}

describe("selectable approval text", () => {
  it("preserves literal text and selects across URL spans without rewriting shell syntax", () => {
    const text = 'Run --name="x" (c) ... https://example.com/a_(b)?x=1&y=2 then package.json';
    const view = render(<SelectableLinkText testID="text">{text}</SelectableLinkText>);
    const element = view.getByTestId("text");
    expect(element.textContent).toBe(text);
    expect(getComputedStyle(element).userSelect).toBe("text");
    expect(select(element)).toBe(text);
    const link = view.getByRole("link") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("https://example.com/a_(b)?x=1&y=2");
    expect(getComputedStyle(link).userSelect).not.toBe("none");
  });

  it("handles quotes, punctuation and multiple URLs, but leaves unsafe schemes and filenames alone", () => {
    const view = render(
      <SelectableLinkText>
        {
          'curl "https://example.com/path"; see (http://example.org/a). javascript:alert(1) file:///tmp/a package.json'
        }
      </SelectableLinkText>,
    );
    expect(view.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "https://example.com/path",
      "http://example.org/a",
    ]);
  });

  it("opens a URL with the existing external opener without activating its surrounding action", () => {
    const parentAction = vi.fn();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const view = render(
      <div onClick={parentAction}>
        <SelectableLinkText>Go to https://example.com/auth</SelectableLinkText>
      </div>,
    );
    act(() => view.getByRole("link").click());
    expect(open).toHaveBeenCalledWith("https://example.com/auth", "_blank", "noopener,noreferrer");
    expect(parentAction).not.toHaveBeenCalled();
    open.mockClear();
    select(container);
    act(() => view.getByRole("link").click());
    expect(open).not.toHaveBeenCalled();
    expect(parentAction).not.toHaveBeenCalled();
  });

  it("keeps question links separate from selecting an answer or submitting approval", () => {
    const onRespond = vi.fn();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const view = render(
      <QuestionFormCard
        permission={{
          key: "q",
          agentId: "agent",
          request: {
            id: "q",
            provider: "claude",
            kind: "question",
            name: "AskUserQuestion",
            input: {
              questions: [
                {
                  question: "Open https://example.com/login?",
                  header: "Login",
                  options: [
                    { label: "Continue", description: "See https://example.org/help" },
                    { label: "Cancel" },
                  ],
                },
              ],
            },
          },
        }}
        onRespond={onRespond}
        isResponding={false}
      />,
    );
    const option = view.getByRole("radio", { name: "Continue" });
    act(() => view.getByRole("link", { name: "https://example.org/help" }).click());
    expect(option.getAttribute("aria-checked")).toBe("false");
    expect(onRespond).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledOnce();
    act(() => option.click());
    expect(option.getAttribute("aria-checked")).toBe("true");
    act(() => view.getByRole("button", { name: "Submit" }).click());
    expect(onRespond).toHaveBeenCalledOnce();
  });
});
