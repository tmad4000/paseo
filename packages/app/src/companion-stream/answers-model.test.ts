import { describe, expect, it } from "vitest";
import type { CompanionEntry, StreamReply } from "@getpaseo/protocol/companion-stream";
import { findAnchoredItem, findMessageItem } from "@/agent-stream/use-timeline-anchor-jump";
import type { StreamItem } from "@/types/stream";
import {
  answersPaneSignature,
  askNextAction,
  hasUnhiddenAnswers,
  hasUnhiddenPaneItems,
  selectOpenAsks,
  selectTrackedAnswers,
  trackedAnswersSignature,
  trackedQuestionEntryId,
} from "./answers-model";
import { openAskFixtureEntries } from "./open-asks-fixture";

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

describe("open asks model", () => {
  const withState = (id: string, state: "open" | "in_progress" | "blocked" | "done", at: string) =>
    ask(id, id, {
      timestamp: at,
      ask: { state, remaining: "", evidence: "", revision: 1, provenance: "explicit" },
    });

  it("lists unresolved asks blocked first, then in progress, then open; newest first", () => {
    const items = selectOpenAsks([
      withState("ask:open", "open", "2026-10-29T09:00:00Z"),
      withState("ask:old-progress", "in_progress", "2026-10-29T08:00:00Z"),
      withState("ask:blocked", "blocked", "2026-10-29T07:00:00Z"),
      withState("ask:new-progress", "in_progress", "2026-10-29T09:30:00Z"),
      withState("ask:done", "done", "2026-10-29T10:00:00Z"),
      qa("tracked-message"),
    ]);
    expect(items.map((item) => [item.entry.id, item.state])).toEqual([
      ["ask:blocked", "blocked"],
      ["ask:new-progress", "in_progress"],
      ["ask:old-progress", "in_progress"],
      ["ask:open", "open"],
    ]);
  });

  it("skips asks listed as questions and linked duplicates of a canonical task", () => {
    const canonical = ask("ask:dup", "Duplicate", {
      ask: {
        state: "in_progress",
        remaining: "",
        evidence: "",
        revision: 1,
        provenance: "explicit",
        canonicalTask: { serverId: "s", agentId: "a", entryId: "ask:origin" },
      },
    });
    const items = selectOpenAsks(
      [ask("ask:q", "Which port?"), ask("ask:task", "Refactor the sidebar"), canonical],
      new Set(["ask:q"]),
    );
    expect(items.map((item) => item.entry.id)).toEqual(["ask:task"]);
  });

  it("takes the first non-empty line of remaining as the next action, with its owner", () => {
    expect(askNextAction("\n  Ship build 2.  \nThen verify.")).toBe("Ship build 2.");
    expect(askNextAction("")).toBe("");
    const [item] = selectOpenAsks([
      ask("ask:x", "X", {
        ask: {
          state: "blocked",
          remaining: "Jacob decides.\nThen build.",
          evidence: "",
          delegatedAgentId: "child-1",
          revision: 1,
          provenance: "explicit",
        },
      }),
    ]);
    expect(item).toMatchObject({ nextAction: "Jacob decides.", delegatedAgentId: "child-1" });
  });

  it("brings a hidden pane back for a newly blocked ask, not for other ask changes", () => {
    const entries = [withState("ask:a", "in_progress", "2026-10-29T09:00:00Z")];
    const hidden = answersPaneSignature([], selectOpenAsks(entries));
    expect(hasUnhiddenPaneItems([], selectOpenAsks(entries), hidden)).toBe(false);
    const more = [...entries, withState("ask:b", "open", "2026-10-29T09:10:00Z")];
    expect(hasUnhiddenPaneItems([], selectOpenAsks(more), hidden)).toBe(false);
    const blocked = [withState("ask:a", "blocked", "2026-10-29T09:00:00Z")];
    expect(hasUnhiddenPaneItems([], selectOpenAsks(blocked), hidden)).toBe(true);
    const blockedHidden = answersPaneSignature([], selectOpenAsks(blocked));
    expect(hasUnhiddenPaneItems([], selectOpenAsks(blocked), blockedHidden)).toBe(false);
    const answer = selectTrackedAnswers([qa("one", { reply: reply() })]);
    expect(hasUnhiddenPaneItems(answer, selectOpenAsks(blocked), blockedHidden)).toBe(true);
  });

  it("splits the orchestration-chat fixture into 3 questions and 17 open asks", () => {
    const entries = openAskFixtureEntries({ release: "agent-release" });
    expect(entries.filter((entry) => entry.ask?.state !== "done")).toHaveLength(20);
    const questions = selectTrackedAnswers(entries);
    const asks = selectOpenAsks(entries, new Set(questions.map((item) => item.entry.id)));
    expect(questions).toHaveLength(3);
    expect(asks).toHaveLength(17);
    expect(asks.slice(0, 5).every((item) => item.state === "blocked")).toBe(true);
    expect(asks.slice(5).some((item) => item.state === "blocked")).toBe(false);
    expect(asks.at(-1)?.state).toBe("open");
    expect(asks.find((item) => item.entry.id === "ask:asc-agreements")?.delegatedAgentId).toBe(
      "agent-release",
    );
  });
});
