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

import { TrackedAnswersPane } from "./answers-pane";

const anchor = (startSeq: number, endSeq = startSeq) => ({ epoch: "e1", startSeq, endSeq });

const waiting: CompanionEntry = {
  id: "qa:e1:4",
  kind: "q_and_a",
  timestamp: "2026-10-26T20:00:00Z",
  text: "Did the deploy finish?",
  truncated: false,
  questionAnchor: anchor(4),
};
const answered: CompanionEntry = {
  id: "qa:e1:1",
  kind: "q_and_a",
  timestamp: "2026-10-26T19:00:00Z",
  text: "Which port does it use?",
  truncated: false,
  questionAnchor: anchor(1),
  answer: "It listens on 7420.",
  answerAnchor: anchor(2, 3),
  answeredAt: "2026-10-26T19:01:00Z",
  status: "open",
};

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
afterEach(cleanup);

describe("TrackedAnswersPane", () => {
  it("separates unseen answers from questions still waiting", () => {
    render(
      <TrackedAnswersPane entries={[waiting, answered]} onJump={vi.fn()} onSetStatus={vi.fn()} />,
    );
    expect(screen.getByText("1 new · 1 waiting")).toBeTruthy();
    expect(screen.getByText("New answer")).toBeTruthy();
    expect(screen.getByText("Waiting for answer")).toBeTruthy();
    expect(screen.getByText("It listens on 7420.")).toBeTruthy();
    expect(screen.getAllByTestId("tracked-answer-mark-seen")).toHaveLength(1);
    expect(screen.getAllByTestId("tracked-answer-stop")).toHaveLength(1);
  });

  it("renders nothing for seen, resolved or untracked entries", () => {
    const { container } = render(
      <TrackedAnswersPane
        entries={[
          { ...answered, status: "reviewed" },
          { ...waiting, status: "done" },
          {
            id: "turn:1",
            kind: "outcome",
            timestamp: "",
            text: "Done",
            truncated: false,
            status: "completed",
          },
        ]}
        onJump={vi.fn()}
        onSetStatus={vi.fn()}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("lets a waiting question stop being tracked instead of being marked seen", () => {
    const onSetStatus = vi.fn().mockResolvedValue(undefined);
    render(<TrackedAnswersPane entries={[waiting]} onJump={vi.fn()} onSetStatus={onSetStatus} />);
    expect(screen.queryByTestId("tracked-answer-mark-seen")).toBeNull();
    fireEvent.click(screen.getByTestId("tracked-answer-stop"));
    expect(onSetStatus).toHaveBeenCalledWith("qa:e1:4", "done");
  });

  it("jumps to the exact question and answer anchors", () => {
    const onJump = vi.fn();
    render(<TrackedAnswersPane entries={[answered]} onJump={onJump} onSetStatus={vi.fn()} />);
    fireEvent.click(screen.getByTestId("tracked-answer-jump-question"));
    fireEvent.click(screen.getByTestId("tracked-answer-jump-answer"));
    expect(onJump.mock.calls).toEqual([[anchor(1)], [anchor(2, 3)]]);
  });

  it("keeps the answer listed until the host records it seen, and shows a failed save", async () => {
    const onSetStatus = vi.fn().mockRejectedValueOnce(new Error("offline"));
    render(<TrackedAnswersPane entries={[answered]} onJump={vi.fn()} onSetStatus={onSetStatus} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("tracked-answer-mark-seen"));
    });
    expect(onSetStatus).toHaveBeenCalledWith("qa:e1:1", "reviewed");
    expect(screen.getByText("It listens on 7420.")).toBeTruthy();
    expect(screen.getByText("Could not mark the answer seen")).toBeTruthy();
  });

  it("collapses, and hiding lasts only until a new answer arrives", () => {
    const { rerender, container } = render(
      <TrackedAnswersPane entries={[answered]} onJump={vi.fn()} onSetStatus={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("tracked-answers-toggle"));
    expect(screen.queryByText("It listens on 7420.")).toBeNull();
    fireEvent.click(screen.getByTestId("tracked-answers-dismiss"));
    expect(container.innerHTML).toBe("");
    rerender(
      <TrackedAnswersPane entries={[answered, waiting]} onJump={vi.fn()} onSetStatus={vi.fn()} />,
    );
    expect(container.innerHTML).toBe("");
    const second = {
      ...waiting,
      answer: "Yes, at 20:05.",
      answerAnchor: anchor(5),
      status: "open" as const,
    };
    rerender(
      <TrackedAnswersPane entries={[answered, second]} onJump={vi.fn()} onSetStatus={vi.fn()} />,
    );
    expect(screen.getByTestId("tracked-answers-pane")).toBeTruthy();
  });
});
