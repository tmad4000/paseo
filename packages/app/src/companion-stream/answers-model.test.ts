import { describe, expect, it } from "vitest";
import type { CompanionEntry, StreamReply } from "@getpaseo/protocol/companion-stream";
import { findAnchoredItem, findMessageItem } from "@/agent-stream/use-timeline-anchor-jump";
import type { StreamItem } from "@/types/stream";
import {
  hasUnhiddenAnswers,
  selectTrackedAnswers,
  trackedAnswersSignature,
  trackedQuestionEntryId,
} from "./answers-model";

const reply = (overrides: Partial<StreamReply> = {}): StreamReply => ({
  text: "a",
  provenance: "explicit",
  revision: 1,
  answeredAt: "2026-10-26T11:00:00Z",
  ...overrides,
});

function qa(id: string, overrides: Partial<Extract<CompanionEntry, { kind: "q_and_a" }>> = {}) {
  return {
    id,
    kind: "q_and_a" as const,
    timestamp: "2026-10-26T10:00:00Z",
    text: id,
    truncated: false,
    questionAnchor: { epoch: "e1", startSeq: 1, endSeq: 1 },
    ...overrides,
  };
}

function ask(id: string, text: string, overrides: Partial<CompanionEntry> = {}): CompanionEntry {
  return {
    id,
    kind: "question",
    status: "open",
    timestamp: "2026-10-26T09:00:00Z",
    text,
    truncated: false,
    ask: { state: "in_progress", remaining: "", evidence: "", revision: 1, provenance: "explicit" },
    ...overrides,
  } as CompanionEntry;
}

describe("tracked answers model", () => {
  it("orders confirmed answers, then possible answers, then waiting questions", () => {
    const items = selectTrackedAnswers([
      qa("waiting-qa"),
      qa("seen", { reply: reply(), replySeenRevision: 1 }),
      qa("candidate", { reply: reply({ provenance: "candidate" }) }),
      ask("ask:waiting", "Which port?"),
      ask("ask:task", "Refactor the sidebar"),
      ask("ask:answered", "Which database?", {
        reply: reply({ answeredAt: "2026-10-26T13:00:00Z" }),
      }),
      qa("answered-older", { reply: reply() }),
    ]);
    expect(items.map((item) => [item.entry.id, item.attention])).toEqual([
      ["ask:answered", "new_answer"],
      ["answered-older", "new_answer"],
      ["candidate", "candidate"],
      ["waiting-qa", "waiting"],
      ["ask:waiting", "waiting"],
    ]);
  });

  it("leaves unanchored, stopped and agent questions out of the pane", () => {
    const agentQuestion = {
      id: "question:name",
      kind: "question" as const,
      status: "open" as const,
      timestamp: "",
      text: "Pick a name?",
      truncated: false,
    };
    expect(
      selectTrackedAnswers([
        qa("legacy", { questionAnchor: undefined }),
        qa("stopped", { status: "done" }),
        agentQuestion,
      ]),
    ).toEqual([]);
  });

  it("brings a hidden pane back for a new answer or a revised one, not for waiting questions", () => {
    const shown = selectTrackedAnswers([qa("one", { reply: reply() }), qa("waiting")]);
    const hidden = trackedAnswersSignature(shown);
    expect(hasUnhiddenAnswers(shown, hidden)).toBe(false);
    expect(
      hasUnhiddenAnswers(
        selectTrackedAnswers([qa("one", { reply: reply() }), qa("waiting"), qa("w2")]),
        hidden,
      ),
    ).toBe(false);
    expect(
      hasUnhiddenAnswers(
        selectTrackedAnswers([qa("one", { reply: reply({ revision: 2 }) })]),
        hidden,
      ),
    ).toBe(true);
    expect(
      hasUnhiddenAnswers(
        selectTrackedAnswers([qa("one", { reply: reply() }), qa("two", { reply: reply() })]),
        hidden,
      ),
    ).toBe(true);
  });

  it("derives one stable entry id per tracked message", () => {
    expect(trackedQuestionEntryId({ epoch: "e1", seq: 12 })).toBe("e1:12");
  });

  it("finds loaded messages by anchor or by an ask's source message id", () => {
    const item = (id: string, seq: number, epoch = "e1", messageId?: string) =>
      ({
        kind: "user_message",
        id,
        messageId,
        text: id,
        timestamp: new Date(0),
        timelineCursor: { epoch, seq },
      }) as StreamItem;
    const items = [item("q", 4, "e1", "m4"), item("old-epoch", 7, "e0"), item("a", 7)];
    expect(findAnchoredItem(items, { epoch: "e1", startSeq: 6, endSeq: 8 })?.id).toBe("a");
    expect(findAnchoredItem(items, { epoch: "e1", startSeq: 9, endSeq: 9 })).toBeUndefined();
    expect(findMessageItem(items, "m4")?.id).toBe("q");
    expect(findMessageItem(items, "missing")).toBeUndefined();
  });
});
