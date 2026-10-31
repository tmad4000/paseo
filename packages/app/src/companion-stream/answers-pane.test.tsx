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
    "aria-expanded": expanded,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    testID?: string;
    accessibilityLabel?: string;
    "aria-expanded"?: boolean;
  }) => (
    <button
      type="button"
      data-testid={testID}
      aria-label={accessibilityLabel}
      aria-expanded={expanded}
      onClick={onPress}
    >
      {children}
    </button>
  ),
}));
// Tooltip text stays in the DOM, hidden, so tests can read what desktop hover would show.
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children?: React.ReactNode }) => children,
  TooltipTrigger: ({ children }: { children?: React.ReactNode }) => children,
  TooltipContent: ({ children }: { children?: React.ReactNode }) => (
    <span hidden data-testid="tooltip">
      {children}
    </span>
  ),
}));
vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => new Proxy({}, { get: () => ({}) }) },
}));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: i18n.t.bind(i18n), i18n }),
}));
vi.mock("lucide-react-native", () => ({
  HelpCircle: () => null,
  Minimize2: () => null,
}));
vi.mock("@/utils/navigate-to-agent", () => ({ navigateToAgent: vi.fn() }));
const layout = vi.hoisted(() => ({ compact: false }));
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => layout.compact }));
vi.mock("./answers-pane-store", async () => {
  const { create } = await import("zustand");
  return {
    useAnswersPaneStore: create<{
      minimized: boolean | null;
      setMinimized: (minimized: boolean) => void;
    }>()((set) => ({
      minimized: null,
      setMinimized: (minimized) => set({ minimized }),
    })),
  };
});
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
import { useAnswersPaneStore } from "./answers-pane-store";
import { computeChatSessions, type ChatMessageEvent } from "./answers-sessions";
import { describeSegment } from "./answers-pane";
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
    jumpToTarget: vi.fn(),
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
afterEach(() => {
  cleanup();
  layout.compact = false;
  useAnswersPaneStore.setState({ minimized: null });
});

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
    expect(handlers.jumpToTarget).toHaveBeenNthCalledWith(1, { anchor: anchor(1) });
    expect(handlers.jumpToAnchor).toHaveBeenCalledWith(anchor(2, 3));
    cleanup();
    renderPane([askAnswered], handlers);
    expect(screen.queryByTestId("tracked-answer-jump-answer")).toBeNull();
    fireEvent.click(screen.getByTestId("tracked-answer-jump-question"));
    fireEvent.click(screen.getByTestId("tracked-answer-open-chat"));
    expect(handlers.jumpToTarget).toHaveBeenNthCalledWith(2, { messageId: "m7" });
    expect(handlers.openChat).toHaveBeenCalledWith("child-1");
  });

  it("jumps to a tracked ask's question by the host's source anchor", () => {
    const handlers = actions();
    renderPane([{ ...askAnswered, sourceAnchor: anchor(9) }], handlers);
    fireEvent.click(screen.getByTestId("tracked-answer-jump-question"));
    expect(handlers.jumpToTarget).toHaveBeenCalledWith({ anchor: anchor(9), messageId: "m7" });
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

  it("minimizes to a count pill that stays put as items arrive, and reopens", () => {
    const handlers = actions();
    const view = (entries: CompanionEntry[]) => (
      <TrackedAnswersPane entries={entries} agentId="parent-1" actions={handlers} />
    );
    const { rerender } = render(view([askAnswered]));
    fireEvent.click(screen.getByTestId("tracked-answers-minimize"));
    expect(screen.queryByText("Postgres 16.")).toBeNull();
    expect(screen.getByTestId("tracked-answers-expand").textContent).toBe("1");
    rerender(view([askAnswered, waiting]));
    expect(screen.getByTestId("tracked-answers-expand").textContent).toBe("2");
    expect(screen.getByTestId("tracked-answers-expand").getAttribute("aria-label")).toBe(
      "Show questions and asks. 1 new · 1 waiting",
    );
    fireEvent.click(screen.getByTestId("tracked-answers-expand"));
    expect(screen.getByText("Postgres 16.")).toBeTruthy();
    expect(screen.queryByTestId("tracked-answers-expand")).toBeNull();
  });

  it("starts minimized on phones, and remembers an explicit choice across chats", () => {
    layout.compact = true;
    renderPane([askAnswered]);
    expect(screen.getByTestId("tracked-answers-expand")).toBeTruthy();
    expect(screen.queryByText("Postgres 16.")).toBeNull();
    fireEvent.click(screen.getByTestId("tracked-answers-expand"));
    cleanup();
    renderPane([askAnswered]);
    expect(screen.getByText("Postgres 16.")).toBeTruthy();
    fireEvent.click(screen.getByTestId("tracked-answers-minimize"));
    cleanup();
    layout.compact = false;
    renderPane([askAnswered]);
    expect(screen.getByTestId("tracked-answers-expand")).toBeTruthy();
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

  it("jumps to an anchored or loaded source, else opens the ask card; owners open their chat", () => {
    const handlers = actions({ hasMessage: vi.fn((id: string) => id === "m-loaded") });
    const loaded = task("loaded", "in_progress", {
      sourceMessageId: "m-loaded",
      delegatedAgentId: "child-1",
    });
    const prose = task("prose", "in_progress", {
      sourceMessageId: "user message 2026-10-29 (no message id exposed)",
    });
    const none = task("none", "open");
    // The host anchors a new ask to the message being answered, even without a message id.
    const anchored = { ...task("anchored", "open"), sourceAnchor: anchor(5) };
    renderAsks([loaded, prose, none, anchored], handlers);
    const open = (id: string) =>
      fireEvent.click(
        screen.getByTestId(`open-ask-ask:${id}`).querySelector('[data-testid="open-ask-open"]')!,
      );
    open("loaded");
    expect(handlers.jumpToTarget).toHaveBeenCalledWith({ messageId: "m-loaded" });
    open("anchored");
    expect(handlers.jumpToTarget).toHaveBeenLastCalledWith({ anchor: anchor(5) });
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

  it("minimizes with asks to a pill counting questions and asks together", () => {
    renderAsks([askAnswered, task("a", "in_progress"), task("b", "blocked")]);
    fireEvent.click(screen.getByTestId("tracked-answers-minimize"));
    expect(screen.queryByTestId("open-asks-section")).toBeNull();
    expect(screen.getByTestId("tracked-answers-expand").textContent).toBe("3");
    fireEvent.click(screen.getByTestId("tracked-answers-expand"));
    expect(screen.getByTestId("open-asks-section")).toBeTruthy();
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

describe("TrackedAnswersPane session dividers", () => {
  // Local wall-clock times in a past year, so labels never read Today or Yesterday.
  const at = (day: number, hour: number, minute = 0) => new Date(2020, 9, day, hour, minute);
  const said = (time: Date, role: ChatMessageEvent["role"] = "user"): ChatMessageEvent => ({
    role,
    time: time.getTime(),
    keys: [],
  });
  const ask = (id: string, time: Date, state: "open" | "blocked" = "open"): CompanionEntry => ({
    id: `ask:${id}`,
    kind: "question",
    status: "open",
    timestamp: time.toISOString(),
    text: `Task ${id}`,
    truncated: false,
    ask: { state, remaining: "", evidence: "", revision: 1, provenance: "explicit" },
  });
  // Morning session, five quiet hours, then an afternoon session.
  const sessions = computeChatSessions(
    [said(at(30, 9)), said(at(30, 9, 30), "assistant"), said(at(30, 14, 30))],
    { historyComplete: true },
  );

  function renderSessions(entries: CompanionEntry[], handlers = actions()) {
    return render(
      <TrackedAnswersPane
        entries={entries}
        agentId="parent-1"
        actions={handlers}
        showOpenAsks
        sessions={sessions}
      />,
    );
  }

  it("groups asks under their sessions, newest first, blocked still first within one", () => {
    renderSessions([
      ask("morning-open", at(30, 9, 5)),
      ask("morning-blocked", at(30, 9, 20), "blocked"),
      ask("afternoon", at(30, 14, 35)),
    ]);
    const section = screen.getByTestId("open-asks-section");
    const order = [...section.querySelectorAll("[data-testid]")]
      .map((node) => node.getAttribute("data-testid")!)
      .filter((id) => id.startsWith("session-divider") || id.startsWith("open-ask-ask:"));
    expect(order).toEqual([
      "session-divider-session",
      "open-ask-ask:afternoon",
      "session-divider-session",
      "open-ask-ask:morning-blocked",
      "open-ask-ask:morning-open",
    ]);
    expect(screen.getByText("New session after 5 h idle")).toBeTruthy();
    expect(screen.getByText("Chat starts")).toBeTruthy();
  });

  it("shows no dividers when everything sits in one session and day", () => {
    renderSessions([ask("a", at(30, 14, 35)), ask("b", at(30, 15))]);
    expect(screen.queryByTestId(/^session-divider/)).toBeNull();
  });

  it("puts unknown times last and keeps questions in their own section", () => {
    const unknown = { ...ask("bad", at(30, 9)), timestamp: "not a date" };
    renderSessions([askAnswered, unknown, ask("now", at(30, 14, 35))]);
    expect(screen.getByText("Time unknown")).toBeTruthy();
    const section = screen.getByTestId("open-asks-section");
    const ids = [...section.querySelectorAll("[data-testid]")].map((node) =>
      node.getAttribute("data-testid"),
    );
    expect(ids.indexOf("session-divider-unknown")).toBeGreaterThan(ids.indexOf("open-ask-ask:now"));
    expect(screen.getByTestId("tracked-answer-ask:db")).toBeTruthy();
  });

  it("keeps an expanded answer expanded through minimize and reopen", () => {
    renderSessions([askAnswered, ask("now", at(30, 14, 35))]);
    fireEvent.click(screen.getByTestId("tracked-answer-text"));
    expect(screen.getByTestId("tracked-answer-text").getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByTestId("tracked-answers-minimize"));
    fireEvent.click(screen.getByTestId("tracked-answers-expand"));
    expect(screen.getByTestId("tracked-answer-text").getAttribute("aria-expanded")).toBe("true");
  });

  it("explains every desktop control in a tooltip", () => {
    renderSessions([askAnswered, ask("now", at(30, 14, 35))]);
    const tips = screen.getAllByTestId("tooltip").map((node) => node.textContent);
    expect(tips).toContain("Minimize to a small pill. Tap the pill to bring the pane back.");
    expect(tips).toContain("Mark this answer seen. A revised answer shows here again.");
    expect(tips).toContain("Jump to your question in Chat");
    expect(tips).toContain("Open the chat that wrote this answer");
    expect(tips).toContain("Jumps to the message that asked it, or opens its card in Stream");
    fireEvent.click(screen.getByTestId("tracked-answers-minimize"));
    expect(screen.getByTestId("tooltip").textContent).toMatch(/^Show questions and asks: /);
  });

  it("names days relative to now, and continued sessions and idle time plainly", () => {
    const t = i18n.t.bind(i18n);
    const now = new Date(2020, 9, 31, 12);
    const session = {
      start: at(31, 8).getTime(),
      end: 0,
      origin: "idle" as const,
      idleMs: 125 * 60_000,
    };
    const today = describeSegment(
      { key: "s", kind: "session", time: session.start, session, sortKey: 0 },
      t,
      "en-US",
      now,
    );
    expect(today.title).toBe("Today, 8:00 AM");
    expect(today.detail).toBe("New session after 2 h 5 min idle");
    const continued = describeSegment(
      { key: "d", kind: "day", time: at(30, 0).getTime(), session, sortKey: 0 },
      t,
      "en-US",
      now,
    );
    expect(continued).toEqual({ title: "Yesterday", detail: "Session continues" });
    const days = describeSegment(
      {
        key: "s2",
        kind: "session",
        time: 0,
        session: { ...session, idleMs: 3 * 24 * 60 * 60_000 },
        sortKey: 0,
      },
      t,
      "en-US",
      now,
    );
    expect(days.detail).toBe("New session after 3 d idle");
    expect(
      describeSegment({ key: "i", kind: "inherited", time: null, sortKey: 0 }, t, "en-US", now),
    ).toEqual({ title: "From the parent chat", detail: "Before this fork" });
  });
});
