import { describe, expect, it } from "vitest";
import { indexStreamMessages } from "./stream-message-inventory.js";
import { applyStreamEntryUpdate } from "./stream-entry-update.js";
import { listStreamRows } from "./global-stream.js";
import type { CompanionEntry } from "@getpaseo/protocol/companion-stream";
import type { ProjectedTimelineRow } from "./timeline-projection.js";

function message(
  seq: number,
  text: string,
  type: "user_message" | "assistant_message" = "user_message",
): ProjectedTimelineRow {
  return {
    seq,
    seqStart: seq,
    seqEnd: seq,
    timestamp: new Date(1700000000000 + seq).toISOString(),
    item: { type, text },
    sourceSeqRanges: [{ startSeq: seq, endSeq: seq }],
    collapsed: [],
  };
}
const source = (entries: CompanionEntry[]) => [
  { id: "session", cwd: "/project", companionEntries: entries },
];

describe("Stream message inventory", () => {
  it("retains 63 messages, repeats, and roles across serialization, reindexing and bounded pages", () => {
    const rows = Array.from({ length: 63 }, (_, i) =>
      message(i + 1, i < 2 ? "Repeat this" : `Request ${i}`),
    );
    rows.push(message(64, "Should I continue?", "assistant_message"));
    const entries = indexStreamMessages([], rows, "epoch");
    expect(entries).toHaveLength(64);
    expect(new Set(entries.map((e) => e.id)).size).toBe(64);
    const restored = JSON.parse(JSON.stringify(entries));
    expect(indexStreamMessages(restored, rows, "epoch")).toBe(restored);
    const first = listStreamRows(source(restored), {
      agentId: "session",
      includeMessageInventory: true,
      sourceRole: "user",
      limit: 50,
    });
    const last = listStreamRows(source(restored), {
      includeMessageInventory: true,
      sourceRole: "user",
      cursor: first.nextCursor!,
      limit: 50,
    });
    expect(first.rows).toHaveLength(50);
    expect(last.rows).toHaveLength(13);
    expect(last.nextCursor).toBeNull();
    const agent = listStreamRows(source(restored), {
      includeMessageInventory: true,
      sourceRole: "agent",
    });
    expect(agent.rows).toHaveLength(1);
    expect(
      listStreamRows(source(restored), { includeMessageInventory: true, asksOnly: true }).counts
        .total,
    ).toBe(63);
    expect(indexStreamMessages(restored, [], "new-epoch")).toHaveLength(64);
  });

  it("review of one multi-ask message never completes its separate tasks", () => {
    let entries = indexStreamMessages(
      [],
      [message(1, "Fix filtering and add direct links")],
      "epoch",
    );
    const original = entries[0];
    const sourceMessageId = original.source!.messageId;
    for (const id of ["filters", "links"])
      entries = applyStreamEntryUpdate(entries, {
        agentId: "session",
        action: "set_ask",
        entryId: id,
        expectedRevision: 0,
        text: id,
        ask: { state: "open", remaining: "Implement", evidence: "", sourceMessageId },
      });
    entries = indexStreamMessages(
      entries,
      [message(21, "Fix filtering and add direct links")],
      "refreshed-epoch",
    );
    expect(
      entries
        .filter((entry) => entry.ask)
        .every(
          (entry) =>
            entry.source?.seq === 21 &&
            entry.source.epoch === "refreshed-epoch" &&
            entry.ask?.revision === 1,
        ),
    ).toBe(true);
    const review = {
      agentId: "session",
      action: "review_message" as const,
      entryId: original.id,
      expectedRevision: 0,
      review: {
        state: "reviewed" as const,
        note: "Two separate requests inventoried",
        askIds: ["filters", "links"],
      },
    };
    entries = applyStreamEntryUpdate(entries, review);
    expect(applyStreamEntryUpdate(entries, review)).toBe(entries);
    expect(entries.filter((e) => e.ask).every((e) => e.ask?.state === "open")).toBe(true);
    expect(
      listStreamRows(source(entries), {
        includeMessageInventory: true,
        asksOnly: true,
        state: "open",
      }).rows,
    ).toHaveLength(2);
    expect(() =>
      applyStreamEntryUpdate(entries, {
        ...review,
        expectedRevision: 0,
        review: { ...review.review, note: "Stale correction" },
      }),
    ).toThrow(/revision conflict/);
    entries = applyStreamEntryUpdate(entries, {
      ...review,
      expectedRevision: 1,
      review: { state: "unreviewed", note: "Check another request", askIds: ["filters", "links"] },
    });
    expect(entries[0].messageReview?.state).toBe("unreviewed");
    expect(() =>
      applyStreamEntryUpdate(entries, {
        agentId: "session",
        action: "update_status",
        entryId: original.id,
        status: "done",
      }),
    ).toThrow(/not task completion/);
    expect(() =>
      applyStreamEntryUpdate(entries, {
        ...review,
        expectedRevision: 2,
        review: { ...review.review, askIds: ["missing"] },
      }),
    ).toThrow(/reference this source/);
  });

  it("reports hidden counts for the installed-example shape without inventing open asks", () => {
    const entries: CompanionEntry[] = Array.from({ length: 8 }, (_, i) => ({
      id: `turn:${i}`,
      kind: "outcome",
      timestamp: new Date(1700000000000 + i).toISOString(),
      text: "Turn ended",
      truncated: false,
      status: i === 0 ? "failed" : "completed",
    }));
    for (let i = 0; i < 2; i++)
      entries.push({
        id: `permission:${i}`,
        kind: "permission",
        timestamp: new Date().toISOString(),
        text: "Allowed",
        truncated: false,
        status: "allowed",
        requestId: `${i}`,
        requestKind: "tool",
      });
    const hidden = listStreamRows(source(entries), {
      state: "open",
      includeMessageInventory: true,
    });
    expect(hidden.rows).toHaveLength(0);
    expect(hidden.counts).toMatchObject({ total: 10, open: 0, matching: 0, agent: 10, user: 0 });
    expect(
      listStreamRows(source(entries), { asksOnly: true, includeMessageInventory: true }).rows,
    ).toHaveLength(0);
    expect(
      listStreamRows(source(entries), { state: "done", sourceRole: "agent" }).rows,
    ).toHaveLength(10);
  });
});
