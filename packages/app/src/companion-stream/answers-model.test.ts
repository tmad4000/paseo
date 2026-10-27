import { describe, expect, it } from "vitest";
import type { CompanionEntry } from "@getpaseo/protocol/companion-stream";
import { findAnchoredItem } from "@/agent-stream/use-timeline-anchor-jump";
import type { StreamItem } from "@/types/stream";
import {
  hasUnhiddenAnswers,
  selectTrackedAnswers,
  trackedAnswersSignature,
  trackedQuestionEntryId,
} from "./answers-model";

function qa(id: string, overrides: Partial<Extract<CompanionEntry, { kind: "q_and_a" }>> = {}) {
  return {
    id,
    kind: "q_and_a" as const,
    timestamp: "2026-10-26T10:00:00Z",
    text: id,
    truncated: false,
    ...overrides,
  };
}

describe("tracked answers model", () => {
  it("leads with new answers, newest first, then waiting questions", () => {
    const items = selectTrackedAnswers([
      qa("waiting-old"),
      qa("seen", { answer: "a", status: "reviewed" }),
      qa("new-old", { answer: "a", answeredAt: "2026-10-26T11:00:00Z" }),
      qa("waiting-new", { timestamp: "2026-10-26T12:00:00Z" }),
      qa("new-recent", { answer: "a", answeredAt: "2026-10-26T13:00:00Z" }),
    ]);
    expect(items.map((item) => [item.entry.id, item.attention])).toEqual([
      ["new-recent", "new_answer"],
      ["new-old", "new_answer"],
      ["waiting-new", "waiting"],
      ["waiting-old", "waiting"],
    ]);
  });

  it("hides only the answers that were showing when the pane was hidden", () => {
    const before = selectTrackedAnswers([qa("one", { answer: "a" }), qa("waiting")]);
    const hidden = trackedAnswersSignature(before);
    expect(hasUnhiddenAnswers(before, hidden)).toBe(false);
    expect(hasUnhiddenAnswers(selectTrackedAnswers([qa("one", { answer: "a" })]), hidden)).toBe(
      false,
    );
    expect(
      hasUnhiddenAnswers(
        selectTrackedAnswers([qa("one", { answer: "a" }), qa("two", { answer: "b" })]),
        hidden,
      ),
    ).toBe(true);
  });

  it("derives one stable entry id per tracked message", () => {
    expect(trackedQuestionEntryId({ epoch: "e1", seq: 12 })).toBe("e1:12");
  });

  it("finds the loaded message covering an anchor in the same epoch", () => {
    const item = (id: string, seq: number, epoch = "e1") =>
      ({
        kind: "user_message",
        id,
        text: id,
        timestamp: new Date(0),
        timelineCursor: { epoch, seq },
      }) as StreamItem;
    const items = [item("q", 4), item("old-epoch", 7, "e0"), item("a", 7)];
    expect(findAnchoredItem(items, { epoch: "e1", startSeq: 6, endSeq: 8 })?.id).toBe("a");
    expect(findAnchoredItem(items, { epoch: "e1", startSeq: 9, endSeq: 9 })).toBeUndefined();
  });
});
