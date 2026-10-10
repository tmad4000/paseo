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
      [{ ...message(1, "Fix filtering and add direct links"), providerMessageId: "multi-ask" }],
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
      [{ ...message(21, "Fix filtering and add direct links"), providerMessageId: "multi-ask" }],
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

  it.each([false, true])(
    "does not transfer reviewed state or linked asks when an identical message leaves the window (provenance=%s)",
    (withProvenance) => {
      const first = {
        ...message(1, "Repeat this"),
        ...(withProvenance ? { providerMessageId: "first" } : {}),
      };
      const second = {
        ...message(2, "Repeat this"),
        ...(withProvenance ? { providerMessageId: "second" } : {}),
      };
      let entries = indexStreamMessages([], [first, second], "old");
      const original = entries[0];
      entries = applyStreamEntryUpdate(entries, {
        agentId: "session",
        action: "set_ask",
        entryId: "first-ask",
        expectedRevision: 0,
        text: "First request",
        ask: {
          state: "open",
          remaining: "Implement",
          evidence: "",
          sourceMessageId: original.source!.messageId,
        },
      });
      entries = applyStreamEntryUpdate(entries, {
        agentId: "session",
        action: "review_message",
        entryId: original.id,
        expectedRevision: 0,
        review: { state: "reviewed", note: "First request inventoried", askIds: ["first-ask"] },
      });
      const reviewed = entries.find((entry) => entry.id === original.id)!;
      const ask = entries.find((entry) => entry.ask)!;
      const next = indexStreamMessages(entries, [second], "new");
      expect(next.find((entry) => entry.id === reviewed.id)).toEqual(reviewed);
      expect(next.find((entry) => entry.ask)).toEqual(ask);
      const current = next.filter((entry) => entry.messageReview && entry.source?.epoch === "new");
      expect(current).toHaveLength(1);
      expect(current[0].source?.seq).toBe(2);
      expect(current[0].messageReview).toMatchObject({ state: "unreviewed", askIds: [] });
      expect(current[0].id).not.toBe(reviewed.id);
      expect(indexStreamMessages(next, [second], "new")).toBe(next);
      // Same-epoch window truncation must also preserve the first observation.
      const sameEpoch = indexStreamMessages(entries, [second], "old");
      expect(sameEpoch).toBe(entries);
    },
  );

  it("keeps one reviewed source when a submitted prompt gains its provider ID", () => {
    const submitted: ProjectedTimelineRow = {
      ...message(1, "Fix filtering and add direct links."),
      item: {
        type: "user_message",
        text: "Fix filtering and add direct links.",
        messageId: "client-1",
        clientMessageId: "client-1",
      },
    };
    let entries = indexStreamMessages([], [submitted], "epoch");
    expect(entries).toHaveLength(1);
    const original = entries[0];
    entries = applyStreamEntryUpdate(entries, {
      agentId: "session",
      action: "review_message",
      entryId: original.id,
      expectedRevision: 0,
      review: { state: "reviewed", note: "No separate asks", askIds: [] },
    });
    const enriched = { ...submitted, providerMessageId: "provider-1" };
    const next = indexStreamMessages(entries, [enriched], "epoch");
    expect(next[0].source?.aliases?.length).toBeGreaterThan(0);
    expect(indexStreamMessages(next, [enriched], "epoch")).toBe(next);
    expect(next.filter((entry) => entry.messageReview)).toHaveLength(1);
    expect(next[0].messageReview?.state).toBe("reviewed");
    // A rehydrated row carrying both provenances resolves to the same record.
    const rehydrated = indexStreamMessages(next, [{ ...enriched, seq: 9, seqEnd: 9 }], "new");
    expect(rehydrated).toHaveLength(1);
    expect(rehydrated[0]).toMatchObject({
      id: original.id,
      messageReview: { state: "reviewed" },
      source: { seq: 9, epoch: "new" },
    });
  });

  it("keeps a reviewed source when provider history replays the prompt without its client ID", () => {
    // Provider echo staged at turn acceptance: the recorded row already has both IDs.
    const accepted: ProjectedTimelineRow = {
      ...message(1, "Ship it."),
      providerMessageId: "provider-2",
      item: {
        type: "user_message",
        text: "Ship it.",
        messageId: "client-2",
        clientMessageId: "client-2",
      },
    };
    let entries = indexStreamMessages([], [accepted], "epoch");
    const original = entries[0];
    entries = applyStreamEntryUpdate(entries, {
      agentId: "session",
      action: "review_message",
      entryId: original.id,
      expectedRevision: 0,
      review: { state: "reviewed", note: "Single ask", askIds: [] },
    });
    // Claude history rebuilds the user message with only the provider ID.
    const replayed: ProjectedTimelineRow = {
      ...message(4, "Ship it."),
      item: { type: "user_message", text: "Ship it.", messageId: "provider-2" },
    };
    const next = indexStreamMessages(entries, [replayed], "restart");
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      id: original.id,
      messageReview: { state: "reviewed" },
      source: { seq: 4, epoch: "restart" },
    });
  });

  it("prefers the reviewed record when several provenances already have one", () => {
    const row: ProjectedTimelineRow = {
      ...message(1, "Repeat this"),
      providerMessageId: "provider-3",
      item: {
        type: "user_message",
        text: "Repeat this",
        messageId: "client-3",
        clientMessageId: "client-3",
      },
    };
    const unreviewedProvider = indexStreamMessages(
      [],
      [{ ...row, item: { type: "user_message", text: "Repeat this", messageId: "provider-3" } }],
      "e",
    )[0];
    let reviewedClient = indexStreamMessages(
      [],
      [{ ...row, providerMessageId: undefined }],
      "e",
    )[0];
    reviewedClient = applyStreamEntryUpdate([reviewedClient], {
      agentId: "session",
      action: "review_message",
      entryId: reviewedClient.id,
      expectedRevision: 0,
      review: { state: "reviewed", note: "Done", askIds: [] },
    })[0];
    const next = indexStreamMessages(
      [unreviewedProvider, reviewedClient],
      [{ ...row, seq: 7, seqEnd: 7 }],
      "e2",
    );
    expect(next.find((entry) => entry.id === reviewedClient.id)?.source).toMatchObject({
      seq: 7,
      epoch: "e2",
    });
    expect(next.find((entry) => entry.id === unreviewedProvider.id)?.source?.seq).toBe(1);
  });

  it("finds a client-keyed source after enrichment when history replays only the provider ID", () => {
    const submitted: ProjectedTimelineRow = {
      ...message(1, "Late echo."),
      item: {
        type: "user_message",
        text: "Late echo.",
        messageId: "client-4",
        clientMessageId: "client-4",
      },
    };
    let entries = indexStreamMessages([], [submitted], "epoch");
    const original = entries[0];
    entries = applyStreamEntryUpdate(entries, {
      agentId: "session",
      action: "set_ask",
      entryId: "late-ask",
      expectedRevision: 0,
      text: "Late ask",
      ask: {
        state: "open",
        remaining: "Do it",
        evidence: "",
        sourceMessageId: original.source!.messageId,
      },
    });
    entries = applyStreamEntryUpdate(entries, {
      agentId: "session",
      action: "review_message",
      entryId: original.id,
      expectedRevision: 0,
      review: { state: "reviewed", note: "One ask", askIds: ["late-ask"] },
    });
    // Provider echo arrives after acceptance: the row is enriched, and the alias is recorded.
    entries = indexStreamMessages(
      entries,
      [{ ...submitted, providerMessageId: "provider-4" }],
      "epoch",
    );
    const aliased = entries.find((entry) => entry.id === original.id)!;
    expect(aliased.source?.aliases?.length).toBeGreaterThan(0);
    expect(entries.find((entry) => entry.ask)?.source?.aliases).toBeUndefined();
    // Restart: provider history carries only the provider ID, no client ID.
    const replayed: ProjectedTimelineRow = {
      ...message(6, "Late echo."),
      item: { type: "user_message", text: "Late echo.", messageId: "provider-4" },
    };
    const restored = JSON.parse(JSON.stringify(entries));
    const next = indexStreamMessages(restored, [replayed], "restart");
    expect(next.filter((entry) => entry.messageReview)).toHaveLength(1);
    expect(next.find((entry) => entry.messageReview)).toMatchObject({
      id: original.id,
      messageReview: { state: "reviewed" },
      source: { seq: 6, epoch: "restart" },
    });
    expect(next.find((entry) => entry.ask)?.source).toMatchObject({ seq: 6, epoch: "restart" });
    expect(indexStreamMessages(next, [replayed], "restart")).toBe(next);
  });

  it("stays idempotent at the alias cap and never aliases assistant records", () => {
    const aliases = Array.from({ length: 8 }, (_, i) => `message:old-${i}`);
    const row: ProjectedTimelineRow = {
      ...message(2, "Capped."),
      providerMessageId: "provider-5",
      item: {
        type: "user_message",
        text: "Capped.",
        messageId: "client-5",
        clientMessageId: "client-5",
      },
    };
    const [created] = indexStreamMessages([], [{ ...row, providerMessageId: undefined }], "e");
    const capped = { ...created, source: { ...created.source!, seq: 2, epoch: "e", aliases } };
    const entries = [capped];
    expect(indexStreamMessages(entries, [row], "e")).toBe(entries);
    const assistant: ProjectedTimelineRow = {
      ...message(3, "Answer.", "assistant_message"),
      providerMessageId: "provider-6",
      item: { type: "assistant_message", text: "Answer.", messageId: "item-6" },
    };
    const [answer] = indexStreamMessages([], [{ ...assistant, providerMessageId: undefined }], "e");
    const next = indexStreamMessages([answer], [assistant], "e");
    expect(next.every((entry) => entry.source?.aliases === undefined)).toBe(true);
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
