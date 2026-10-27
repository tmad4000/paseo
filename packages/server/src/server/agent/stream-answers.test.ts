import { describe, expect, it } from "vitest";
import {
  getAnswerAttention,
  isUserQuestionEntry,
  type CompanionEntry,
} from "@getpaseo/protocol/companion-stream";
import type { StreamEntryUpdate } from "@getpaseo/protocol/global-stream";
import { attachCandidateReplies, type AnswerTimelineRow } from "./stream-answers.js";
import { applyStreamEntryUpdate } from "./stream-entry-update.js";
import { COMPANION_ENTRY_LIMIT, selectSnapshotCompanionEntries } from "./companion-stream.js";
import { listStreamRows } from "./global-stream.js";

const EPOCH = "epoch-1";
const NOW = "2026-10-26T20:00:00.000Z";

function row(seq: number, item: AnswerTimelineRow["item"], seqEnd = seq): AnswerTimelineRow {
  return { item, seqStart: seq, seqEnd };
}

const user = (text: string, messageId?: string) => ({
  type: "user_message" as const,
  text,
  messageId,
});
const assistant = (text: string, messageId?: string) => ({
  type: "assistant_message" as const,
  text,
  messageId,
});
const tool = {
  type: "tool_call" as const,
  callId: "c1",
  name: "Bash",
  status: "completed" as const,
  detail: { type: "unknown" as const, input: null, output: null },
  error: null,
};

const apply = (entries: CompanionEntry[], input: Omit<StreamEntryUpdate, "agentId">) =>
  applyStreamEntryUpdate(entries, { agentId: "a", ...input });

function track(entries: CompanionEntry[], seq: number, text = "Which port does it use?") {
  return apply(entries, {
    action: "add_q_and_a",
    entryId: `seq-${seq}`,
    text,
    sourceId: "msg:user-msg-1",
    questionAnchor: { epoch: EPOCH, startSeq: seq, endSeq: seq },
  });
}

function trackAsk(
  entries: CompanionEntry[],
  askId: string,
  text: string,
  extra: { expectsAnswer?: boolean; sourceMessageId?: string } = {},
) {
  return apply(entries, {
    action: "set_ask",
    entryId: askId,
    text,
    expectedRevision: 0,
    ask: { state: "in_progress", remaining: "Find out", evidence: "", ...extra },
  });
}

const answer = (entryId: string, text: string, replyRevision: number, by?: string) => ({
  action: "set_reply" as const,
  entryId,
  text,
  replyRevision,
  ...(by ? { answeredByAgentId: by } : {}),
});

function find(entries: CompanionEntry[], id: string): CompanionEntry {
  const entry = entries.find((item) => item.id === id);
  if (!entry) throw new Error(`missing ${id}`);
  return entry;
}

function candidate(entries: CompanionEntry[], rows: AnswerTimelineRow[], turnSettled = true) {
  return attachCandidateReplies({ entries, rows, epoch: EPOCH, turnSettled, now: NOW });
}

describe("answers to user questions", () => {
  it("lets agent-tracked asks wait for an answer without any tap, but not agent questions", () => {
    let entries = trackAsk([], "port", "Which port does the preview use?");
    entries = trackAsk(entries, "deploy", "Deploy the docs site", { expectsAnswer: true });
    entries = trackAsk(entries, "refactor", "Refactor the sidebar");
    entries = apply(entries, { action: "add_question", entryId: "choose", text: "Pick a name?" });
    expect(entries.map((entry) => [entry.id, getAnswerAttention(entry)])).toEqual([
      ["ask:port", "waiting"],
      ["ask:deploy", "waiting"],
      ["ask:refactor", null],
      ["question:choose", null],
    ]);
    expect(() => apply(entries, answer("question:choose", "Paseo", 0))).toThrow(
      "not to an agent's question",
    );
  });

  it("attaches explicit answers with revisions, idempotent repeats and conflicts", () => {
    let entries = trackAsk([], "port", "Which port does the preview use?");
    entries = apply(entries, answer("ask:port", "7420", 0));
    expect(find(entries, "ask:port")).toMatchObject({
      reply: { text: "7420", provenance: "explicit", revision: 1, answeredAt: expect.any(String) },
    });
    expect(apply(entries, answer("ask:port", "7420", 0))).toBe(entries);
    expect(() => apply(entries, answer("ask:port", "7421", 0))).toThrow("replyRevision must be 1");
    entries = apply(entries, answer("ask:port", "7421", 1));
    expect(find(entries, "ask:port").reply?.revision).toBe(2);
  });

  it("keeps seen per answer revision; a revised answer is unseen again, other entries untouched", () => {
    let entries = trackAsk([], "port", "Which port?");
    entries = trackAsk(entries, "db", "Which database?");
    entries = apply(entries, answer("ask:port", "7420", 0));
    entries = apply(entries, answer("ask:db", "Postgres", 0));
    entries = apply(entries, { action: "mark_reply_seen", entryId: "ask:port", replyRevision: 1 });
    entries = apply(entries, { action: "mark_reply_seen", entryId: "ask:db", replyRevision: 1 });
    expect(entries.map(getAnswerAttention)).toEqual([null, null]);
    entries = apply(entries, answer("ask:port", "7421 after the config change", 1));
    expect(entries.map(getAnswerAttention)).toEqual(["new_answer", null]);
    // Seen never moves backwards, and cannot jump ahead of the answer.
    expect(apply(entries, { action: "mark_reply_seen", entryId: "ask:db", replyRevision: 1 })).toBe(
      entries,
    );
    expect(() =>
      apply(entries, { action: "mark_reply_seen", entryId: "ask:port", replyRevision: 3 }),
    ).toThrow("does not exist");
    expect(() =>
      apply(trackAsk([], "x", "Which port?"), {
        action: "mark_reply_seen",
        entryId: "ask:x",
        replyRevision: 1,
      }),
    ).toThrow("no answer to mark seen");
  });

  it("keeps the answer and seen state when the ask itself is revised or completed", () => {
    let entries = trackAsk([], "port", "Which port?");
    entries = apply(entries, answer("ask:port", "7420", 0));
    entries = apply(entries, { action: "mark_reply_seen", entryId: "ask:port", replyRevision: 1 });
    entries = apply(entries, {
      action: "set_ask",
      entryId: "port",
      text: "Which port?",
      expectedRevision: 1,
      ask: { state: "done", remaining: "", evidence: "Confirmed in config" },
    });
    expect(find(entries, "ask:port")).toMatchObject({
      reply: { text: "7420", revision: 1 },
      replySeenRevision: 1,
      ask: { state: "done", revision: 2 },
    });
    // Execution done is not seen: a finished ask with an unseen answer still asks for attention.
    let unseen = trackAsk([], "x", "Which port?");
    unseen = apply(unseen, answer("ask:x", "7420", 0));
    unseen = apply(unseen, {
      action: "set_ask",
      entryId: "x",
      text: "Which port?",
      expectedRevision: 1,
      ask: { state: "done", remaining: "", evidence: "Answered" },
    });
    expect(getAnswerAttention(find(unseen, "ask:x"))).toBe("new_answer");
  });

  it("gives several asks from one message their own answers", () => {
    let entries = trackAsk([], "port", "Which port?", { sourceMessageId: "m1" });
    entries = trackAsk(entries, "db", "Which database?", { sourceMessageId: "m1" });
    entries = apply(entries, answer("ask:db", "Postgres", 0));
    entries = apply(entries, answer("ask:port", "7420", 0));
    expect(entries.map((entry) => entry.reply?.text)).toEqual(["7420", "Postgres"]);
  });

  it("replaces an acknowledgement candidate with the real answer given after more chat", () => {
    const rows = [
      row(4, user("Which port does it use?")),
      row(5, assistant("I'll check and get back to you.")),
      row(6, user("Meanwhile, rename the button")),
      row(7, assistant("Renamed.")),
    ];
    let entries = candidate(track([], 4), rows);
    const tracked = find(entries, "qa:seq-4");
    expect(tracked.reply).toMatchObject({
      text: "I'll check and get back to you.",
      provenance: "candidate",
      revision: 1,
      anchor: { epoch: EPOCH, startSeq: 5, endSeq: 5 },
    });
    expect(getAnswerAttention(tracked)).toBe("candidate");
    // A later candidate never overwrites, even once more replies exist.
    expect(candidate(entries, [...rows, row(8, assistant("Port 7420"))])).toBe(entries);
    // The explicit late answer, here from a delegated chat, replaces the acknowledgement.
    entries = apply(entries, answer("qa:seq-4", "7420, from the preview config", 1, "child-1"));
    expect(find(entries, "qa:seq-4")).toMatchObject({
      reply: { provenance: "explicit", revision: 2, answeredByAgentId: "child-1" },
    });
    expect(getAnswerAttention(find(entries, "qa:seq-4"))).toBe("new_answer");
  });

  it("selects the final response after the last tool call, never failures or open spans", () => {
    const settled = [
      row(4, user("Which port?")),
      row(5, assistant("Let me check.")),
      row(6, tool),
      row(7, assistant("It listens on 7420.", "asst-2"), 9),
    ];
    expect(find(candidate(track([], 4), settled), "qa:seq-4").reply).toMatchObject({
      text: "It listens on 7420.",
      messageId: "asst-2",
      anchor: { startSeq: 7, endSeq: 9 },
    });
    const entries = track([], 4);
    expect(candidate(entries, settled, false)).toBe(entries);
    const failed = [
      row(4, user("Which port?")),
      row(5, tool),
      row(6, assistant("[System Error] provider exited")),
    ];
    expect(candidate(entries, failed)).toBe(entries);
  });

  it("re-anchors by message id after an epoch change and respects stop tracking", () => {
    const rows = [row(20, user("Which port?", "user-msg-1")), row(21, assistant("7420"))];
    const moved = attachCandidateReplies({
      entries: track([], 4),
      rows,
      epoch: "epoch-2",
      turnSettled: true,
      now: NOW,
    });
    expect(find(moved, "qa:seq-4")).toMatchObject({
      questionAnchor: { epoch: "epoch-2", startSeq: 20 },
      reply: { anchor: { epoch: "epoch-2", startSeq: 21 } },
    });
    const stopped = apply(track([], 4), {
      action: "update_status",
      entryId: "qa:seq-4",
      status: "done",
    });
    expect(getAnswerAttention(find(stopped, "qa:seq-4"))).toBeNull();
    expect(candidate(stopped, [row(4, user("Which port?")), row(5, assistant("7420"))])).toBe(
      stopped,
    );
    expect(() =>
      apply(track([], 4), { action: "update_status", entryId: "qa:seq-4", status: "reviewed" }),
    ).toThrow("Mark the answer seen");
  });

  it("resumes a stopped message when it is tracked again, keeping its answer", () => {
    let entries = candidate(track([], 4), [row(4, user("Which port?")), row(5, assistant("7420"))]);
    entries = apply(entries, { action: "update_status", entryId: "qa:seq-4", status: "done" });
    expect(getAnswerAttention(find(entries, "qa:seq-4"))).toBeNull();
    entries = track(entries, 4);
    expect(find(entries, "qa:seq-4")).toMatchObject({ status: "open", reply: { text: "7420" } });
    expect(getAnswerAttention(find(entries, "qa:seq-4"))).toBe("candidate");
  });

  it("keeps an ask's expectsAnswer when an edit omits it", () => {
    let entries = trackAsk([], "deploy", "Deploy the docs site", { expectsAnswer: true });
    const edit = {
      action: "set_ask" as const,
      entryId: "deploy",
      text: "Deploy the docs site",
      expectedRevision: 1,
      ask: { state: "blocked" as const, remaining: "Waiting on DNS", evidence: "" },
    };
    entries = apply(entries, edit);
    expect(find(entries, "ask:deploy")).toMatchObject({
      ask: { expectsAnswer: true, revision: 2 },
    });
    expect(getAnswerAttention(find(entries, "ask:deploy"))).toBe("waiting");
    // Repeating that edit is still a no-op.
    expect(apply(entries, { ...edit, expectedRevision: 2 })).toBe(entries);
  });

  it("dedupes tracking by stable ID and ignores unanchored legacy records", () => {
    const first = track([], 4);
    expect(track(first, 4)).toEqual(first);
    expect(first).toHaveLength(1);
    const legacy = apply([], { action: "add_q_and_a", text: "Old question", answerText: "Old" });
    expect(getAnswerAttention(legacy[0])).toBeNull();
    expect(isUserQuestionEntry(legacy[0])).toBe(true);
  });

  it("lists user questions for agents and keeps attention items in the wire snapshot", () => {
    let entries = trackAsk([], "port", "Which port?");
    entries = trackAsk(entries, "refactor", "Refactor the sidebar");
    entries = [...entries, ...track([], 4)];
    const listed = listStreamRows([{ id: "a", cwd: "/p", companionEntries: entries }], {
      userQuestionsOnly: true,
    }).rows.map((item) => (item.item.kind === "entry" ? item.item.entry.id : null));
    expect(listed.sort()).toEqual(["ask:port", "qa:seq-4"]);

    const outcomes: CompanionEntry[] = Array.from(
      { length: COMPANION_ENTRY_LIMIT + 5 },
      (_, index) => ({
        id: `turn:${index}`,
        kind: "outcome",
        timestamp: NOW,
        text: `Outcome ${index}`,
        truncated: false,
        status: "completed",
      }),
    );
    const snapshot = selectSnapshotCompanionEntries([...entries, ...outcomes]);
    expect(snapshot.slice(0, 2).map((entry) => entry.id)).toEqual(["ask:port", "qa:seq-4"]);
    expect(snapshot).toHaveLength(COMPANION_ENTRY_LIMIT + 2);
  });
});
