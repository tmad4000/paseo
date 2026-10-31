import { describe, expect, it } from "vitest";
import type { CompanionEntry } from "@getpaseo/protocol/companion-stream";
import type { StreamEntryUpdate } from "@getpaseo/protocol/global-stream";
import type { AnswerTimelineRow } from "./stream-answers.js";
import { applyStreamEntryUpdate } from "./stream-entry-update.js";
import { attachSourceAnchors } from "./stream-source-anchor.js";

const EPOCH = "epoch-1";

function row(seq: number, item: AnswerTimelineRow["item"], seqEnd = seq): AnswerTimelineRow {
  return { item, seqStart: seq, seqEnd };
}

const rows: AnswerTimelineRow[] = [
  row(1, { type: "user_message", text: "First", messageId: "u1" }),
  row(2, { type: "assistant_message", text: "Part one", messageId: "a1" }),
  row(3, { type: "assistant_message", text: "Part two", messageId: "a1" }, 4),
  row(5, { type: "user_message", text: "Build the jump", clientMessageId: "c2" }),
  row(6, { type: "assistant_message", text: "On it", messageId: "a2" }),
];
const timeline = { rows, epoch: EPOCH };

/** Apply a Stream write the way the agent manager does. */
function write(
  entries: CompanionEntry[],
  input: Omit<StreamEntryUpdate, "agentId">,
  withTimeline: typeof timeline | null = timeline,
): CompanionEntry[] {
  const after = applyStreamEntryUpdate(entries, { agentId: "a", ...input });
  return attachSourceAnchors({ before: entries, after, timeline: withTimeline });
}

function setAsk(
  entries: CompanionEntry[],
  expectedRevision: number,
  extra: { sourceMessageId?: string; state?: "open" | "in_progress" } = {},
  withTimeline: typeof timeline | null = timeline,
) {
  return write(
    entries,
    {
      action: "set_ask",
      entryId: "jump",
      text: "Jump to the source message",
      expectedRevision,
      ask: { state: extra.state ?? "in_progress", remaining: "Build it", evidence: "", ...extra },
    },
    withTimeline,
  );
}

const anchorOf = (entries: CompanionEntry[], id: string) =>
  entries.find((entry) => entry.id === id)?.sourceAnchor;

describe("attachSourceAnchors", () => {
  it("anchors a new ask without a source to the user message being answered", () => {
    const entries = setAsk([], 0);
    expect(anchorOf(entries, "ask:jump")).toEqual({ epoch: EPOCH, startSeq: 5, endSeq: 5 });
  });

  it("anchors a named source message, by provider or client id", () => {
    expect(anchorOf(setAsk([], 0, { sourceMessageId: "u1" }), "ask:jump")).toEqual({
      epoch: EPOCH,
      startSeq: 1,
      endSeq: 1,
    });
    expect(anchorOf(setAsk([], 0, { sourceMessageId: "c2" }), "ask:jump")).toEqual({
      epoch: EPOCH,
      startSeq: 5,
      endSeq: 5,
    });
  });

  it("keeps the anchor through a full ask replacement, even with the timeline unloaded", () => {
    const created = setAsk([], 0);
    const updated = setAsk(created, 1, { state: "open" }, null);
    expect(anchorOf(updated, "ask:jump")).toEqual({ epoch: EPOCH, startSeq: 5, endSeq: 5 });
  });

  it("does not guess for an existing ask that never had an anchor", () => {
    const legacy = setAsk([], 0, {}, null);
    expect(anchorOf(legacy, "ask:jump")).toBeUndefined();
    expect(anchorOf(setAsk(legacy, 1, { state: "open" }), "ask:jump")).toBeUndefined();
  });

  it("anchors a pin to every row of its assistant message, and never guesses for pins", () => {
    const pinned = write([], { action: "add_pin", text: "On it", sourceId: "msg:a1" });
    const pin = pinned.find((entry) => entry.kind === "pin");
    expect(pin?.sourceAnchor).toEqual({ epoch: EPOCH, startSeq: 2, endSeq: 4 });

    const unsourced = write([], { action: "add_pin", text: "A loose note" });
    expect(unsourced.find((entry) => entry.kind === "pin")?.sourceAnchor).toBeUndefined();
  });

  it("leaves untouched entries as the same objects", () => {
    const created = setAsk([], 0);
    const after = write(created, { action: "add_pin", text: "Note", sourceId: "msg:u1" });
    expect(after.find((entry) => entry.id === "ask:jump")).toBe(
      created.find((entry) => entry.id === "ask:jump"),
    );
  });
});
