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
    ...overrides,
  };
}

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
