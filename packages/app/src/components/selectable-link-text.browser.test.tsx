/* Test fixtures are intentionally declared inline for readability. */
/* oxlint-disable react-perf/jsx-no-new-object-as-prop, react-perf/jsx-no-jsx-as-prop */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { within } from "@testing-library/dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { SelectableLinkText } from "./selectable-link-text";
import { QuestionFormCard } from "./question-form-card";
import { PlanCard } from "./plan-card";
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
    act(() =>
      view
        .getByRole("link")
        .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 })),
    );
    expect(open).not.toHaveBeenCalled();
    expect(parentAction).not.toHaveBeenCalled();
  });

  it("opens a focused link with Enter while its text remains selected", async () => {
    const parentAction = vi.fn();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const view = render(
      <div onClick={parentAction}>
        <SelectableLinkText>Go to https://example.com/auth</SelectableLinkText>
      </div>,
    );
    const link = view.getByRole("link");
    link.focus();
    expect(select(link)).toBe("https://example.com/auth");
    await act(async () => {
      await userEvent.keyboard("{Enter}");
    });
    expect(open).toHaveBeenCalledWith("https://example.com/auth", "_blank", "noopener,noreferrer");
    expect(parentAction).not.toHaveBeenCalled();
  });

  it("opens pointer clicks when selection is outside the link", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const view = render(
      <>
        <p data-testid="other">Other selected text</p>
        <SelectableLinkText>Go to https://example.com/auth</SelectableLinkText>
      </>,
    );
    select(view.getByTestId("other"));
    act(() =>
      view
        .getByRole("link")
        .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 })),
    );
    expect(open).toHaveBeenCalledWith("https://example.com/auth", "_blank", "noopener,noreferrer");
  });

  it.each(["prose", "inline", "fence", "indented"])(
    "preserves encoded command URLs in plan %s",
    (kind) => {
      const command = 'curl "https://example.com/a%20b?x=%2F&y=%25" --name="x"';
      let text = command;
      if (kind === "inline") {
        text = `\`${command}\``;
      } else if (kind === "fence") {
        text = `\`\`\`sh\n${command}\n\`\`\``;
      } else if (kind === "indented") {
        text = `    ${command}`;
      }
      const open = vi.spyOn(window, "open").mockReturnValue(null);
      const view = render(<PlanCard text={text} testID="plan" />);
      const body = view.getByTestId("plan").lastElementChild!;
      expect(body.textContent?.trimEnd()).toBe(command);
      expect(select(body).trimEnd()).toBe(command);
      const link = view.getByRole("link", { name: "https://example.com/a%20b?x=%2F&y=%25" });
      expect(link.getAttribute("href")).toBe("https://example.com/a%20b?x=%2F&y=%25");
      window.getSelection()?.removeAllRanges();
      act(() => link.click());
      expect(open).toHaveBeenCalledWith(
        "https://example.com/a%20b?x=%2F&y=%25",
        "_blank",
        "noopener,noreferrer",
      );
    },
  );

  it("retains explicit markdown link destinations around code labels", () => {
    const view = render(
      <PlanCard text="[`https://example.com/a%20b`](https://example.org/help)" />,
    );
    const links = view.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe("https://example.com/a%20b");
    expect(links[0].getAttribute("href")).toBe("https://example.org/help");
  });

  it.each([
    { key: "{Enter}", selection: "body" },
    { key: " ", selection: "body" },
    { key: "{Enter}", selection: "header" },
    { key: " ", selection: "header" },
    { key: "{Enter}", selection: "other" },
    { key: " ", selection: "other" },
  ] as const)(
    "toggles plans with $key while $selection text is selected",
    async ({ key, selection }) => {
      const view = render(
        <>
          <p data-testid="other">Unrelated text</p>
          <PlanCard title="Review plan" text="Plan body" />
        </>,
      );
      const header = view.getByRole("button", { name: "Review plan" });
      const targets = {
        header,
        body: view.getByText("Plan body"),
        other: view.getByTestId("other"),
      };
      act(() => header.focus());
      expect(select(targets[selection])).not.toBe("");
      await act(async () => {
        await userEvent.keyboard(key);
      });
      expect(header.getAttribute("aria-expanded")).toBe("false");
      expect(view.queryByText("Plan body")).toBeNull();
      await act(async () => {
        await userEvent.keyboard(key);
      });
      expect(header.getAttribute("aria-expanded")).toBe("true");
      expect(view.getByText("Plan body").textContent).toBe("Plan body");
    },
  );

  it("toggles plans on pointer clicks with an unrelated selection", () => {
    const view = render(
      <>
        <p data-testid="other">Unrelated text</p>
        <PlanCard title="Review plan" text="Plan body" />
      </>,
    );
    const header = view.getByRole("button", { name: "Review plan" });
    select(view.getByTestId("other"));
    act(() =>
      header.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 })),
    );
    expect(header.getAttribute("aria-expanded")).toBe("false");
    act(() =>
      header.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 })),
    );
    expect(header.getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps the plan expanded when a pointer selection ends on its selectable title", () => {
    const view = render(<PlanCard title="Review plan" text="Plan body" />);
    const header = view.getByRole("button", { name: "Review plan" });
    const title = view.getByText("Review plan");
    expect(getComputedStyle(title).userSelect).toBe("text");
    expect(select(title)).toBe("Review plan");
    act(() =>
      header.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 })),
    );
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(window.getSelection()?.toString()).toBe("Review plan");
    window.getSelection()?.removeAllRanges();
    act(() =>
      header.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 })),
    );
    expect(header.getAttribute("aria-expanded")).toBe("false");
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
