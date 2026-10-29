// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CompanionEntry } from "@getpaseo/protocol/companion-stream";
import { i18n } from "@/i18n/i18next";

vi.mock("react-native", () => ({
  View: ({ children, testID }: { children?: React.ReactNode; testID?: string }) => (
    <div data-testid={testID}>{children}</div>
  ),
  ScrollView: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  Pressable: ({
    children,
    onPress,
    testID,
    accessibilityLabel,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    testID?: string;
    accessibilityLabel?: string;
  }) => (
    <button type="button" data-testid={testID} aria-label={accessibilityLabel} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => new Proxy({}, { get: () => ({}) }) },
}));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: i18n.t.bind(i18n) }),
}));
vi.mock("lucide-react-native", () => ({
  ChevronDown: () => null,
  ChevronUp: () => null,
  HelpCircle: () => null,
  X: () => null,
}));
vi.mock("@/utils/navigate-to-agent", () => ({ navigateToAgent: vi.fn() }));
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => false }));
vi.mock("@/components/ui/status-badge", () => ({
  StatusBadge: ({ label }: { label: string }) => <span>{label}</span>,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onPress,
    disabled,
    testID,
  }: {
    children: React.ReactNode;
    onPress?: () => void;
    disabled?: boolean;
    testID?: string;
  }) => (
    <button type="button" data-testid={testID} onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
}));

import { TrackedAnswersPane, type TrackedAnswerActions } from "./answers-pane";
import { followUpChatFixtureEntries, openAskFixtureEntries } from "./open-asks-fixture";

const anchor = (startSeq: number, endSeq = startSeq) => ({ epoch: "e1", startSeq, endSeq });

const waiting: CompanionEntry = {
  id: "qa:e1:4",
  kind: "q_and_a",
  timestamp: "2026-10-26T20:00:00Z",
  text: "Did the deploy finish?",
  truncated: false,
  questionAnchor: anchor(4),
};
const candidate: CompanionEntry = {
  id: "qa:e1:1",
  kind: "q_and_a",
  timestamp: "2026-10-26T19:00:00Z",
  text: "Which port does it use?",
  truncated: false,
  questionAnchor: anchor(1),
  reply: {
    text: "I'll check the config.",
    provenance: "candidate",
    revision: 1,
    answeredAt: "2026-10-26T19:01:00Z",
    anchor: anchor(2, 3),
  },
};
const askAnswered: CompanionEntry = {
  id: "ask:db",
  kind: "question",
  status: "open",
  timestamp: "2026-10-26T18:00:00Z",
  text: "Which database does staging use?",
  truncated: false,
  ask: {
    state: "in_progress",
    remaining: "",
    evidence: "",
    sourceMessageId: "m7",
    revision: 1,
    provenance: "explicit",
  },
  reply: {
    text: "Postgres 16.",
    provenance: "explicit",
    revision: 2,
    answeredAt: "2026-10-26T19:30:00Z",
    answeredByAgentId: "child-1",
  },
};

function actions(overrides: Partial<TrackedAnswerActions> = {}): TrackedAnswerActions {
  return {
    jumpToAnchor: vi.fn(),
    jumpToMessage: vi.fn(),
    openChat: vi.fn(),
    markSeen: vi.fn().mockResolvedValue(undefined),
    stopTracking: vi.fn().mockResolvedValue(undefined),
    hasMessage: vi.fn().mockReturnValue(false),
    openAsk: vi.fn(),
    ...overrides,
  };
}

const TITLES: Record<string, string> = {
  "child-1": "Release agent",
  "agent-release": "Release agent",
  "agent-owner": "Mock builder",
};
const agentTitle = (id: string) => TITLES[id];

function renderPane(entries: CompanionEntry[], handlers = actions()) {
  return render(<TrackedAnswersPane entries={entries} agentId="parent-1" actions={handlers} />);
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
afterEach(cleanup);

describe("TrackedAnswersPane", () => {
  it("labels confirmed answers, unconfirmed possible answers and waiting questions", () => {
    renderPane([waiting, candidate, askAnswered]);
    expect(screen.getByText("2 new · 1 waiting")).toBeTruthy();
    expect(screen.getByText("New answer")).toBeTruthy();
    expect(screen.getByText("Possible answer")).toBeTruthy();
    expect(screen.getByText(/has not confirmed/)).toBeTruthy();
    expect(screen.getByText("Waiting for answer")).toBeTruthy();
    expect(screen.getAllByTestId("tracked-answer-mark-seen")).toHaveLength(2);
    expect(screen.getAllByTestId("tracked-answer-stop")).toHaveLength(1);
  });

  it("renders nothing for seen answers, stopped questions or other entries", () => {
    const { container } = renderPane([
      { ...askAnswered, replySeenRevision: 2 },
      { ...waiting, status: "done" },
      {
        id: "turn:1",
        kind: "outcome",
        timestamp: "",
        text: "Done",
        truncated: false,
        status: "completed",
      },
    ]);
    expect(container.innerHTML).toBe("");
  });

  it("marks the shown revision seen, and stops tracking a waiting message", async () => {
    const handlers = actions();
    renderPane([askAnswered, waiting], handlers);
    await act(async () => {
      fireEvent.click(screen.getByTestId("tracked-answer-mark-seen"));
      fireEvent.click(screen.getByTestId("tracked-answer-stop"));
    });
    expect(handlers.markSeen).toHaveBeenCalledWith("ask:db", 2);
    expect(handlers.stopTracking).toHaveBeenCalledWith("qa:e1:4");
  });

  it("jumps to anchors, to an ask's source message, and opens the answering chat", () => {
    const handlers = actions();
    renderPane([candidate], handlers);
    fireEvent.click(screen.getByTestId("tracked-answer-jump-question"));
    fireEvent.click(screen.getByTestId("tracked-answer-jump-answer"));
    expect(handlers.jumpToAnchor).toHaveBeenNthCalledWith(1, anchor(1));
    expect(handlers.jumpToAnchor).toHaveBeenNthCalledWith(2, anchor(2, 3));
    cleanup();
    renderPane([askAnswered], handlers);
    expect(screen.queryByTestId("tracked-answer-jump-answer")).toBeNull();
    fireEvent.click(screen.getByTestId("tracked-answer-jump-question"));
    fireEvent.click(screen.getByTestId("tracked-answer-open-chat"));
    expect(handlers.jumpToMessage).toHaveBeenCalledWith("m7");
    expect(handlers.openChat).toHaveBeenCalledWith("child-1");
  });

  it("keeps the answer listed until the host records it seen, and shows a failed save", async () => {
    renderPane(
      [askAnswered],
      actions({ markSeen: vi.fn().mockRejectedValueOnce(new Error("offline")) }),
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("tracked-answer-mark-seen"));
    });
    expect(screen.getByText("Postgres 16.")).toBeTruthy();
    expect(screen.getByText("Could not mark the answer seen")).toBeTruthy();
  });

  it("collapses, and hiding lasts until a new or revised answer arrives", () => {
    const handlers = actions();
    const view = (entries: CompanionEntry[]) => (
      <TrackedAnswersPane entries={entries} agentId="parent-1" actions={handlers} />
    );
    const { rerender, container } = render(view([askAnswered]));
    fireEvent.click(screen.getByTestId("tracked-answers-toggle"));
    expect(screen.queryByText("Postgres 16.")).toBeNull();
    fireEvent.click(screen.getByTestId("tracked-answers-dismiss"));
    expect(container.innerHTML).toBe("");
    rerender(view([askAnswered, waiting]));
    expect(container.innerHTML).toBe("");
    const revised = { ...askAnswered, reply: { ...askAnswered.reply!, revision: 3 } };
    rerender(view([revised, waiting]));
    expect(screen.getByTestId("tracked-answers-pane")).toBeTruthy();
  });
});

describe("TrackedAnswersPane open asks", () => {
  const task = (
    id: string,
    state: "open" | "in_progress" | "blocked" | "done",
    extra: Partial<NonNullable<CompanionEntry["ask"]>> = {},
    text = `Task ${id}`,
  ): CompanionEntry => ({
    id: `ask:${id}`,
    kind: "question",
    status: "open",
    timestamp: "2026-10-29T09:00:00Z",
    text,
    truncated: false,
    ask: { state, remaining: "", evidence: "", revision: 1, provenance: "explicit", ...extra },
  });

  function renderAsks(entries: CompanionEntry[], handlers = actions()) {
    return render(
      <TrackedAnswersPane
        entries={entries}
        agentId="parent-1"
        actions={handlers}
        showOpenAsks
        agentTitle={agentTitle}
      />,
    );
  }

  it("stays questions-only on hosts without the feature", () => {
    const { container } = renderPane([task("a", "blocked")]);
    expect(container.innerHTML).toBe("");
    cleanup();
    renderPane([askAnswered, task("a", "blocked")]);
    expect(screen.queryByTestId("open-asks-section")).toBeNull();
    expect(screen.getByText("Your questions")).toBeTruthy();
  });

  it("lists unresolved asks with state, owner and next action; done asks never show", () => {
    renderAsks(
      [
        task("progress", "in_progress", {
          remaining: "Ship build 2.\nThen verify.",
          delegatedAgentId: "child-1",
        }),
        task("blocked", "blocked", { remaining: "Jacob picks a direction." }),
        task("open", "open", { delegatedAgentId: "child-unknown-123456" }),
        task("done", "done"),
      ],
      actions(),
    );
    expect(screen.getByText("Questions and asks")).toBeTruthy();
    expect(screen.getByText("3 open asks · 1 blocked")).toBeTruthy();
    expect(screen.getByText("Open asks · 3")).toBeTruthy();
    expect(screen.queryByText("Task done")).toBeNull();
    const rows = screen.getAllByTestId(/^open-ask-ask:/).map((row) => row.dataset.testid);
    expect(rows).toEqual(["open-ask-ask:blocked", "open-ask-ask:progress", "open-ask-ask:open"]);
    expect(screen.getByText("Blocked")).toBeTruthy();
    expect(screen.getByText("In progress")).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByText("Next: Ship build 2.")).toBeTruthy();
    expect(screen.queryByText(/Then verify/)).toBeNull();
    expect(screen.getByText("Release agent")).toBeTruthy();
    // An owner this client has no title for still links, by a short id.
    expect(screen.getByText("child-un")).toBeTruthy();
  });

  it("jumps to a loaded source message, else opens the ask card; owners open their chat", () => {
    const handlers = actions({ hasMessage: vi.fn((id: string) => id === "m-loaded") });
    const loaded = task("loaded", "in_progress", {
      sourceMessageId: "m-loaded",
      delegatedAgentId: "child-1",
    });
    const prose = task("prose", "in_progress", {
      sourceMessageId: "user message 2026-10-29 (no message id exposed)",
    });
    const none = task("none", "open");
    renderAsks([loaded, prose, none], handlers);
    const open = (id: string) =>
      fireEvent.click(
        screen.getByTestId(`open-ask-ask:${id}`).querySelector('[data-testid="open-ask-open"]')!,
      );
    open("loaded");
    expect(handlers.jumpToMessage).toHaveBeenCalledWith("m-loaded");
    expect(handlers.openAsk).not.toHaveBeenCalled();
    open("prose");
    open("none");
    expect(handlers.openAsk).toHaveBeenNthCalledWith(1, prose);
    expect(handlers.openAsk).toHaveBeenNthCalledWith(2, none);
    fireEvent.click(screen.getByTestId("open-ask-owner"));
    expect(handlers.openChat).toHaveBeenCalledWith("child-1");
  });

  it("keeps questions above the asks without listing a question twice", () => {
    renderAsks([askAnswered, task("a", "in_progress")]);
    expect(screen.getByText("Questions · 1")).toBeTruthy();
    expect(screen.getByText("Open asks · 1")).toBeTruthy();
    expect(screen.getByTestId("tracked-answer-ask:db")).toBeTruthy();
    expect(screen.queryByTestId("open-ask-ask:db")).toBeNull();
  });

  it("collapses, and hiding lasts until an answer arrives or an ask becomes blocked", () => {
    const handlers = actions();
    const view = (entries: CompanionEntry[]) => (
      <TrackedAnswersPane entries={entries} agentId="parent-1" actions={handlers} showOpenAsks />
    );
    const progress = task("a", "in_progress");
    const { rerender, container } = render(view([progress]));
    fireEvent.click(screen.getByTestId("tracked-answers-toggle"));
    expect(screen.queryByTestId("open-asks-section")).toBeNull();
    fireEvent.click(screen.getByTestId("tracked-answers-dismiss"));
    expect(container.innerHTML).toBe("");
    rerender(view([progress, task("b", "open")]));
    expect(container.innerHTML).toBe("");
    rerender(view([task("a", "blocked"), task("b", "open")]));
    expect(screen.getByTestId("tracked-answers-pane")).toBeTruthy();
  });

  it("shows the orchestration-chat fixture: 3 questions, 17 open asks, blocked first", () => {
    renderAsks(openAskFixtureEntries({ release: "agent-release" }));
    expect(screen.getByText("3 waiting · 17 open asks · 5 blocked")).toBeTruthy();
    expect(screen.getAllByTestId(/^tracked-answer-ask:/)).toHaveLength(3);
    const rows = screen.getAllByTestId(/^open-ask-ask:/);
    expect(rows).toHaveLength(17);
    const states = rows.map((row) => row.textContent?.match(/^(Blocked|In progress|Open)/)?.[1]);
    expect(states.slice(0, 5)).toEqual(Array(5).fill("Blocked"));
    expect(states.slice(5).includes("Blocked")).toBe(false);
    expect(screen.getAllByText("Release agent").length).toBeGreaterThan(0);
  });

  it("shows the follow-up-chat fixture: done asks gone, blocked asks first", () => {
    renderAsks(followUpChatFixtureEntries("agent-owner"));
    expect(screen.getByText("2 waiting · 8 open asks · 5 blocked")).toBeTruthy();
    expect(screen.getAllByTestId(/^tracked-answer-ask:/)).toHaveLength(2);
    const rows = screen.getAllByTestId(/^open-ask-ask:/);
    expect(rows).toHaveLength(8);
    expect(rows.some((row) => row.dataset.testid?.includes("done-"))).toBe(false);
    const states = rows.map((row) => row.textContent?.match(/^(Blocked|In progress|Open)/)?.[1]);
    expect(states).toEqual([...Array(5).fill("Blocked"), ...Array(3).fill("In progress")]);
    expect(screen.getByText("Mock builder")).toBeTruthy();
    expect(screen.getByText("Next: Graph save blocked on the same credential.")).toBeTruthy();
  });
});
