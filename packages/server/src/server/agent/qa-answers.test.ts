import { describe, expect, it } from "vitest";
import { getQAndAAttention, type CompanionEntry } from "@getpaseo/protocol/companion-stream";
import { attachQAndAAnswers, type AnswerTimelineRow } from "./qa-answers.js";
import { applyStreamEntryUpdate } from "./stream-entry-update.js";
import { COMPANION_ENTRY_LIMIT, selectSnapshotCompanionEntries } from "./companion-stream.js";

const EPOCH = "epoch-1";
const NOW = "2026-10-26T20:00:00.000Z";

function row(seq: number, item: AnswerTimelineRow["item"], seqEnd = seq): AnswerTimelineRow {
  return { item, seqStart: seq, seqEnd };
}

const user = (text: string) => ({ type: "user_message" as const, text });
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

function track(entries: CompanionEntry[], seq: number, text = "Which port does it use?") {
  return applyStreamEntryUpdate(entries, {
    agentId: "a",
    action: "add_q_and_a",
    entryId: `seq-${seq}`,
    text,
    sourceId: "msg:user-msg-1",
    questionAnchor: { epoch: EPOCH, startSeq: seq, endSeq: seq },
  });
}

function qa(entries: CompanionEntry[]) {
  const entry = entries.find((item) => item.kind === "q_and_a");
  if (entry?.kind !== "q_and_a") throw new Error("missing q_and_a");
  return entry;
}

describe("tracked question answers", () => {
  it("tracks a message once, keeping its anchor and message id", () => {
    const first = track([], 4);
    expect(track(first, 4)).toEqual(first);
    expect(qa(first)).toMatchObject({
      id: "qa:seq-4",
      questionMessageId: "user-msg-1",
      questionAnchor: { epoch: EPOCH, startSeq: 4, endSeq: 4 },
    });
    expect(getQAndAAttention(qa(first))).toBe("waiting");
  });

  it("attaches the final response after the last tool call, and leaves it unseen", () => {
    const rows = [
      row(4, user("Which port does it use?")),
      row(5, assistant("Let me check the config.")),
      row(6, tool),
      row(7, assistant("It listens on 7420.", "asst-2"), 9),
      row(10, user("Thanks, next thing")),
    ];
    const entries = attachQAndAAnswers({
      entries: track([], 4),
      rows,
      epoch: EPOCH,
      turnSettled: false,
      now: NOW,
    });
    expect(qa(entries)).toMatchObject({
      answer: "It listens on 7420.",
      answerAnchor: { epoch: EPOCH, startSeq: 7, endSeq: 9 },
      answerMessageId: "asst-2",
      answeredAt: NOW,
      status: "open",
    });
    expect(getQAndAAttention(qa(entries))).toBe("new_answer");
  });

  it("does not attach a reply that is still being written", () => {
    const entries = track([], 4);
    const rows = [row(4, user("Which port?")), row(5, assistant("It listens on"))];
    expect(attachQAndAAnswers({ entries, rows, epoch: EPOCH, turnSettled: false, now: NOW })).toBe(
      entries,
    );
    expect(
      qa(attachQAndAAnswers({ entries, rows, epoch: EPOCH, turnSettled: true, now: NOW })).answer,
    ).toBe("It listens on");
  });

  it("stays waiting when only tool work followed, or the timeline epoch changed", () => {
    const entries = track([], 4);
    const toolOnly = [row(4, user("Which port?")), row(5, assistant("Checking")), row(6, tool)];
    expect(
      attachQAndAAnswers({ entries, rows: toolOnly, epoch: EPOCH, turnSettled: true, now: NOW }),
    ).toBe(entries);
    const answered = [row(4, user("Which port?")), row(5, assistant("7420"))];
    expect(
      attachQAndAAnswers({
        entries,
        rows: answered,
        epoch: "epoch-2",
        turnSettled: true,
        now: NOW,
      }),
    ).toBe(entries);
  });

  it("never replaces an attached answer", () => {
    const rows = [row(4, user("Which port?")), row(5, assistant("7420"))];
    const answered = attachQAndAAnswers({
      entries: track([], 4),
      rows,
      epoch: EPOCH,
      turnSettled: true,
      now: NOW,
    });
    const later = [...rows, row(6, assistant("Actually 7421"))];
    expect(
      attachQAndAAnswers({
        entries: answered,
        rows: later,
        epoch: EPOCH,
        turnSettled: true,
        now: NOW,
      }),
    ).toBe(answered);
  });

  it("marks an answer seen only explicitly, and only once an answer exists", () => {
    const waiting = track([], 4);
    expect(() =>
      applyStreamEntryUpdate(waiting, {
        agentId: "a",
        action: "update_status",
        entryId: "qa:seq-4",
        status: "reviewed",
      }),
    ).toThrow("no answer to mark seen");
    const answered = attachQAndAAnswers({
      entries: waiting,
      rows: [row(4, user("Which port?")), row(5, assistant("7420"))],
      epoch: EPOCH,
      turnSettled: true,
      now: NOW,
    });
    const seen = applyStreamEntryUpdate(answered, {
      agentId: "a",
      action: "update_status",
      entryId: "qa:seq-4",
      status: "reviewed",
    });
    expect(getQAndAAttention(qa(seen))).toBeNull();
    const unseen = applyStreamEntryUpdate(seen, {
      agentId: "a",
      action: "update_status",
      entryId: "qa:seq-4",
      status: "open",
    });
    expect(getQAndAAttention(qa(unseen))).toBe("new_answer");
  });

  it("keeps older waiting and unseen questions in the bounded wire snapshot", () => {
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
    const waiting = qa(track([], 1));
    const seen: CompanionEntry = {
      ...qa(track([], 2)),
      id: "qa:seen",
      answer: "x",
      status: "reviewed",
    };
    const snapshot = selectSnapshotCompanionEntries([waiting, seen, ...outcomes]);
    expect(snapshot).toHaveLength(COMPANION_ENTRY_LIMIT + 1);
    expect(snapshot[0]).toBe(waiting);
    expect(snapshot.some((entry) => entry.id === "qa:seen")).toBe(false);
  });
});
