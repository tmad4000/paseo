import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { CompanionEntry } from "@getpaseo/protocol/companion-stream";
import { i18n } from "@/i18n/i18next";
import { TrackedAnswersPane, type TrackedAnswerActions } from "./answers-pane";
import { useAnswersPaneStore } from "./answers-pane-store";
import { computeChatSessions, type ChatMessageEvent } from "./answers-sessions";

void i18n;
const fixture = vi.hoisted(() => ({ compact: false }));
vi.mock("@/constants/layout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/constants/layout")>()),
  useIsCompactFormFactor: () => fixture.compact,
}));
// Keep the real tooltip, layout and pointer events; the harness has no native animation runtime.
vi.mock("react-native-reanimated", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native-reanimated")>();
  const { View } = await import("react-native");
  const animation = { duration: () => animation };
  return {
    ...actual,
    default: { ...actual.default, View },
    FadeIn: animation,
    FadeOut: animation,
  };
});

// A past year, so day labels are dates rather than Today or Yesterday.
const at = (day: number, hour: number, minute = 0) => new Date(2020, 9, day, hour, minute);
const said = (time: Date, role: ChatMessageEvent["role"] = "user"): ChatMessageEvent => ({
  role,
  time: time.getTime(),
  keys: [],
});
// A morning session, five quiet hours, then an afternoon session that runs past midnight.
const sessions = computeChatSessions(
  [
    said(at(30, 9)),
    said(at(30, 9, 30), "assistant"),
    ...[14.5, 16, 17.5, 19, 20.5, 22, 23.5].map((hour) =>
      said(at(30, Math.floor(hour), (hour % 1) * 60)),
    ),
    said(at(31, 0, 30), "assistant"),
  ],
  { historyComplete: true },
);

function ask(
  id: string,
  time: Date,
  state: "open" | "in_progress" | "blocked",
  remaining = "",
): CompanionEntry {
  return {
    id: `ask:${id}`,
    kind: "question",
    status: "open",
    timestamp: time.toISOString(),
    text: id,
    truncated: false,
    ask: { state, remaining, evidence: "", revision: 1, provenance: "explicit" },
  };
}

const entries: CompanionEntry[] = [
  {
    ...ask("Which database does staging use?", at(30, 14, 40), "in_progress"),
    reply: {
      text: "Postgres 16 on the shared cluster, upgraded last week.",
      provenance: "explicit",
      revision: 2,
      answeredAt: at(30, 15).toISOString(),
    },
  },
  ask("Ship the Enforce build to TestFlight", at(31, 0, 35), "blocked", "Waiting on signing."),
  ask("Draft the release notes", at(30, 14, 50), "in_progress", "Collect merged PRs."),
  ask("Audit the morning deploy", at(30, 9, 10), "open"),
];

const actions: TrackedAnswerActions = {
  jumpToAnchor: () => {},
  jumpToMessage: () => {},
  jumpToTarget: () => {},
  openChat: () => {},
  markSeen: async () => {},
  stopTracking: async () => {},
  hasMessage: () => false,
  openAsk: () => {},
};

let mounted: { root: Root; container: HTMLElement } | null = null;

beforeEach(() => {
  // Some sources compile JSX to React.createElement without importing React.
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

async function mountPane(width: number): Promise<HTMLElement> {
  await page.viewport(width, 900);
  const container = document.createElement("div");
  // Stands in for the chat the pane floats over.
  Object.assign(container.style, {
    position: "relative",
    width: `${width}px`,
    height: "900px",
    background: "#fafafa",
  });
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <TrackedAnswersPane
        entries={entries}
        agentId="chat-1"
        actions={actions}
        showOpenAsks
        sessions={sessions}
      />,
    ),
  );
  mounted = { root, container };
  return container;
}

/**
 * No doubled rules: walking the list top to bottom, a horizontal rule never directly follows
 * another (one element's bottom rule and the next one's top rule, or two stacked top rules
 * with nothing between). The first divider sits on the panel rule rather than adding one.
 */
function expectSingleRules(): void {
  const width = (element: Element, side: "Top" | "Bottom") =>
    Number.parseFloat(getComputedStyle(element)[`border${side}Width`]) || 0;
  const rows = [
    ...document.querySelectorAll(
      '[data-testid^="session-divider-"], [data-testid^="open-ask-ask:"], [data-testid^="tracked-answer-ask:"], h1, [role="heading"]',
    ),
  ];
  expect(rows.length).toBeGreaterThan(4);
  const dividers = rows.filter((row) =>
    row.getAttribute("data-testid")?.startsWith("session-divider-"),
  );
  expect(dividers.length).toBeGreaterThan(1);
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1]!;
    const current = rows[index]!;
    if (previous.contains(current) || current.contains(previous)) continue;
    expect(width(previous, "Bottom") > 0 && width(current, "Top") > 0).toBe(false);
    // An element right under a rule-drawing divider or section label adds no rule of its own.
    // Dividers and section labels are headers (h1 on web).
    const previousIsSeparator =
      previous.tagName === "H1" || previous.getAttribute("role") === "heading";
    if (previousIsSeparator) expect(width(current, "Top")).toBe(0);
  }
  for (const divider of dividers) {
    expect(getComputedStyle(divider.firstElementChild!).fontWeight).toBe("400");
  }
}

function rect(testId: string): DOMRect {
  const element = document.querySelector(`[data-testid="${testId}"]`);
  if (!element) throw new Error(`Missing ${testId}`);
  return element.getBoundingClientRect();
}

afterEach(() => {
  if (mounted) {
    act(() => mounted!.root.unmount());
    mounted.container.remove();
    mounted = null;
  }
  fixture.compact = false;
  useAnswersPaneStore.setState({ minimized: null });
  vi.unstubAllGlobals();
});

describe("TrackedAnswersPane in a browser", () => {
  it("on a phone: starts as a small pill, and opens into a full-width card with dividers", async () => {
    fixture.compact = true;
    await mountPane(390);
    const pill = rect("tracked-answers-expand");
    expect(pill.width).toBeLessThan(120);
    expect(pill.right).toBeGreaterThan(390 - 40);

    await page.getByTestId("tracked-answers-expand").click();
    const card = rect("tracked-answers-minimize");
    // The old bug: the header collapsed to nothing but its icons.
    expect(card.width).toBeGreaterThan(390 - 40);
    await expect.element(page.getByText("Questions and asks", { exact: true })).toBeVisible();
    await expect.element(page.getByText("New session after 5 h idle").first()).toBeVisible();
    // The divider's detail wraps under a long date instead of being cut off.
    const detail = page.getByText("New session after 5 h idle").first().element();
    expect(detail.scrollWidth).toBeLessThanOrEqual(detail.clientWidth + 1);
    await expect.element(page.getByText("Session continues")).toBeVisible();
    expectSingleRules();
  });

  it("on desktop: shows a tooltip on hover and keeps the expanded answer through minimize", async () => {
    await mountPane(1440);
    await expect.element(page.getByText("Chat starts")).toBeVisible();
    await page.getByTestId("tracked-answer-text").click();
    await userEvent.hover(page.getByTestId("tracked-answers-minimize"));
    await expect
      .element(page.getByText("Minimize to a small pill. Tap the pill to bring the pane back."))
      .toBeVisible();
    await userEvent.unhover(page.getByTestId("tracked-answers-minimize"));

    await page.getByTestId("tracked-answers-minimize").click();
    await userEvent.hover(page.getByTestId("tracked-answers-expand"));
    await expect.element(page.getByText(/^Show questions and asks: /)).toBeVisible();
    await page.getByTestId("tracked-answers-expand").click();
    await expect
      .element(page.getByTestId("tracked-answer-text"))
      .toHaveAttribute("aria-expanded", "true");
  });
});
