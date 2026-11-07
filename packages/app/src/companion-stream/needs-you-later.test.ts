import { describe, expect, it } from "vitest";
import type { GlobalStreamRow } from "./use-global-stream";
import { splitLater } from "./needs-you-later";

function row(id: string, deferredAt?: string): GlobalStreamRow {
  return {
    id,
    timestamp: "2026-11-01T00:00:00Z",
    serverId: "host",
    serverLabel: "Host",
    agentId: "agent",
    agentTitle: "Chat",
    cwd: "/p",
    archived: false,
    item: {
      kind: "entry",
      entry: {
        id: `question:${id}`,
        kind: "question",
        status: "open",
        timestamp: "2026-11-01T00:00:00Z",
        text: id,
        truncated: false,
        ...(deferredAt ? { deferredAt } : {}),
      },
    },
  };
}

describe("splitLater", () => {
  const rows = [row("a"), row("b", "2026-11-01T01:00:00Z"), row("c")];

  it("shows Now or Later in Needs you, with both counts for the switch", () => {
    expect(splitLater(rows, "needs_you", false)).toEqual({
      data: [rows[0], rows[2]],
      nowCount: 2,
      laterCount: 1,
    });
    expect(splitLater(rows, "needs_you", true).data).toEqual([rows[1]]);
  });

  it("keeps the chosen side even when it is empty, and leaves other views untouched", () => {
    const plain = [row("a")];
    expect(splitLater(plain, "needs_you", true)).toEqual({ data: [], nowCount: 1, laterCount: 0 });
    expect(splitLater(rows, "tasks", true)).toEqual({ data: rows, nowCount: 0, laterCount: 0 });
  });
});

describe("splitLater with blocked asks", () => {
  it("moves a deferred blocked ask to Later", () => {
    const blocked = row("blocked", "2026-11-01T02:00:00Z");
    if (blocked.item.kind === "entry")
      blocked.item.entry = {
        ...blocked.item.entry,
        id: "ask:blocked",
        ask: {
          state: "blocked",
          remaining: "Needs your go-ahead",
          evidence: "",
          revision: 1,
          provenance: "explicit",
        },
      };
    expect(splitLater([row("a"), blocked], "needs_you", true).data).toEqual([blocked]);
    expect(splitLater([row("a"), blocked], "needs_you", false).laterCount).toBe(1);
  });
});
