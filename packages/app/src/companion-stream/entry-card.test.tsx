// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { needsUserInput, type CompanionEntry } from "@getpaseo/protocol/companion-stream";
import { i18n } from "@/i18n/i18next";

vi.mock("react-native", () => ({
  View: ({ children, testID }: { children?: React.ReactNode; testID?: string }) => (
    <div data-testid={testID}>{children}</div>
  ),
  Text: ({
    children,
    testID,
    onPress,
  }: {
    children?: React.ReactNode;
    testID?: string;
    onPress?: () => void;
  }) => (
    <span data-testid={testID} onClick={onPress}>
      {children}
    </span>
  ),
}));
vi.mock("react-native-unistyles", () => ({ StyleSheet: { create: () => ({}) } }));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: i18n.t.bind(i18n) }),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onPress,
    disabled,
  }: {
    children: React.ReactNode;
    onPress?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/markdown/renderer", () => ({
  MarkdownRenderer: ({ text }: { text: string }) => <div data-testid="markdown">{text}</div>,
}));
vi.mock("@/utils/navigate-to-agent", () => ({ navigateToAgent: vi.fn() }));
vi.mock("@/utils/time", () => ({ formatMessageTimestamp: () => "Oct 24, 2:10 PM" }));

import { EntryCard } from "./entry-card";
import { navigateToAgent } from "@/utils/navigate-to-agent";

const ask: CompanionEntry = {
  id: "ask:ship",
  kind: "question",
  status: "open",
  timestamp: "2026-10-24T21:10:00Z",
  text: "Ship Stream tags\nWith a tag cloud and filters.",
  truncated: false,
  ask: {
    state: "blocked",
    remaining: "Waiting for review",
    evidence: "Unit tests pass",
    revision: 2,
    provenance: "explicit",
  },
};

const tagged: CompanionEntry = {
  id: "pin:n",
  kind: "pin",
  timestamp: ask.timestamp,
  text: "Keep this #Design idea",
  truncated: false,
};
const quote: CompanionEntry = {
  id: "pin:q",
  kind: "pin",
  sourceId: "msg:42",
  timestamp: ask.timestamp,
  text: "The tension is the teaching.",
  truncated: false,
};

const humanRequest: CompanionEntry = {
  id: "question:needed",
  kind: "question",
  status: "open",
  timestamp: ask.timestamp,
  text: "Choose a date",
  truncated: false,
  inputRequest: { kind: "decision", recipient: "user" },
};

const sourceAnchor = { epoch: "e1", startSeq: 7, endSeq: 7 };
const anchored: CompanionEntry = { ...ask, sourceAnchor };

function renderCard(entry: CompanionEntry) {
  return render(
    <EntryCard
      entry={entry}
      onReturnToChat={vi.fn()}
      onReplyInChat={vi.fn()}
      onUpdateStatus={vi.fn()}
      onRemovePin={vi.fn()}
    />,
  );
}

describe("EntryCard", () => {
  beforeAll(async () => {
    if (!i18n.isInitialized) await i18n.init();
    await i18n.changeLanguage("en");
  });
  // Component files rely on the bundler's React global, as in the other Stream tests.
  beforeEach(() => vi.stubGlobal("React", React));
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("labels a concrete decision and opens its task source on the named host", () => {
    const view = renderCard({
      id: "question:choice",
      kind: "question",
      status: "open",
      timestamp: ask.timestamp,
      text: "Choose the publishing date",
      truncated: false,
      inputRequest: {
        kind: "decision",
        recipient: "user",
        subtaskId: "publish",
        sourceMessageId: "message-3",
        task: { serverId: "m5", agentId: "owner", entryId: "ask:release" },
      },
    });
    expect(view.getByText("Decision · Needs you").textContent).toBe("Decision · Needs you");
    expect(view.getByText("Subtask: publish").textContent).toBe("Subtask: publish");
    fireEvent.click(view.getByText("Open task source"));
    expect(navigateToAgent).toHaveBeenLastCalledWith({ serverId: "m5", agentId: "owner" });
  });

  it("marks a human request seen without resolving it; Read only expands and Done resolves explicitly", () => {
    const entry = humanRequest;
    const onUpdateStatus = vi.fn();
    const view = render(
      <EntryCard
        entry={entry}
        onReturnToChat={vi.fn()}
        onReplyInChat={vi.fn()}
        onUpdateStatus={onUpdateStatus}
        onRemovePin={vi.fn()}
      />,
    );
    expect(view.queryByRole("button", { name: "Reviewed" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Read" }));
    expect(onUpdateStatus).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", { name: "Seen (still needed)" }));
    expect(onUpdateStatus).toHaveBeenLastCalledWith(entry.id, "reviewed");
    expect(needsUserInput({ ...entry, status: "reviewed" })).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Done" }));
    expect(onUpdateStatus).toHaveBeenLastCalledWith(entry.id, "done");
    expect(needsUserInput({ ...entry, status: "done" })).toBe(false);
  });

  it.each(["agent", "external"] as const)(
    "keeps Reviewed for requests addressed to %s",
    (recipient) => {
      const view = renderCard({
        id: "question:other",
        kind: "question",
        status: "open",
        timestamp: ask.timestamp,
        text: "Choose a date",
        truncated: false,
        inputRequest: { kind: "decision", recipient, recipientId: "recipient-1" },
      });
      expect(view.getByRole("button", { name: "Reviewed" })).toBeTruthy();
      expect(view.queryByRole("button", { name: "Seen (still needed)" })).toBeNull();
    },
  );

  it("puts kind, state and time in one eyebrow and the text first line as headline", () => {
    const view = renderCard(ask);
    expect(view.getByTestId("companion-entry-eyebrow").textContent).toBe(
      "Ask · Blocked · Oct 24, 2:10 PM",
    );
    expect(view.getByText("Ship Stream tags")).toBeTruthy();
    expect(view.getByText("With a tag cloud and filters.")).toBeTruthy();
    expect(view.container.textContent).not.toMatch(/explicit/i);
  });

  it("renders hashtags as links that set the tag filter", () => {
    const onTagPress = vi.fn();
    const view = render(
      <EntryCard
        entry={tagged}
        onReturnToChat={vi.fn()}
        onReplyInChat={vi.fn()}
        onUpdateStatus={vi.fn()}
        onRemovePin={vi.fn()}
        onTagPress={onTagPress}
      />,
    );
    fireEvent.click(view.getByTestId("stream-hashtag-design"));
    expect(onTagPress).toHaveBeenCalledWith("design");
    expect(view.getByTestId("companion-entry-eyebrow").textContent).toBe(
      "Pinned · Oct 24, 2:10 PM",
    );
  });

  it("presents an excerpt pin with a source as a Quote that opens its chat", () => {
    const onReturnToChat = vi.fn();
    const view = render(
      <EntryCard
        entry={quote}
        onReturnToChat={onReturnToChat}
        onReplyInChat={vi.fn()}
        onUpdateStatus={vi.fn()}
        onRemovePin={vi.fn()}
      />,
    );
    expect(view.getByTestId("companion-entry-quote").textContent).toBe(
      "The tension is the teaching.",
    );
    expect(view.getByTestId("companion-entry-eyebrow").textContent).toMatch(/^Quote · /);
    fireEvent.click(view.getByText("Open source chat"));
    expect(onReturnToChat).toHaveBeenCalled();
  });

  it("keeps ask evidence and remaining work behind Read", () => {
    const view = renderCard(ask);
    expect(view.queryByText("Remaining: Waiting for review")).toBeNull();
    fireEvent.click(view.getByText("Read"));
    expect(view.getByText("Remaining: Waiting for review")).toBeTruthy();
    expect(view.getByText("Evidence so far: Unit tests pass")).toBeTruthy();
    expect(view.getByText("Done").closest("button")?.disabled).toBe(true);
  });

  it("offers Show in chat with the entry's place, keeping Reply for pending asks", () => {
    const onShowInChat = vi.fn();
    const onReplyInChat = vi.fn();
    const view = render(
      <EntryCard
        entry={anchored}
        onReturnToChat={vi.fn()}
        onReplyInChat={onReplyInChat}
        onShowInChat={onShowInChat}
        onUpdateStatus={vi.fn()}
        onRemovePin={vi.fn()}
      />,
    );
    fireEvent.click(view.getByRole("button", { name: "Show in chat" }));
    expect(onShowInChat).toHaveBeenLastCalledWith({ anchor: sourceAnchor });
    fireEvent.click(view.getByRole("button", { name: "Reply in chat" }));
    expect(onReplyInChat).toHaveBeenCalled();
    cleanup();

    // A quote's Open source becomes Show in chat, addressed by its message id.
    const quoteView = render(
      <EntryCard
        entry={quote}
        onReturnToChat={vi.fn()}
        onReplyInChat={vi.fn()}
        onShowInChat={onShowInChat}
        onUpdateStatus={vi.fn()}
        onRemovePin={vi.fn()}
      />,
    );
    expect(quoteView.queryByRole("button", { name: "Open source" })).toBeNull();
    fireEvent.click(quoteView.getByRole("button", { name: "Show in chat" }));
    expect(onShowInChat).toHaveBeenLastCalledWith({ messageId: "42" });
    cleanup();

    // Nothing to place: the card keeps Back to chat.
    const plain = renderCard(tagged);
    expect(plain.queryByRole("button", { name: "Show in chat" })).toBeNull();
    expect(plain.getByRole("button", { name: "Back to chat" })).toBeTruthy();
  });
});
