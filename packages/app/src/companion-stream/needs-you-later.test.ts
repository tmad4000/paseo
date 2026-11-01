import { describe, expect, it } from "vitest";
import type { GlobalStreamRow } from "./use-global-stream";
import { arrangeLater, LATER_HEADER } from "./needs-you-later";

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

describe("arrangeLater", () => {
  const rows = [row("a"), row("b", "2026-11-01T01:00:00Z"), row("c")];

  it("moves deferred requests under a collapsed Later header in Needs you", () => {
    const collapsed = arrangeLater(rows, "needs_you", false);
    expect(collapsed.laterCount).toBe(1);
    expect(collapsed.data).toEqual([rows[0], rows[2], LATER_HEADER]);
    expect(arrangeLater(rows, "needs_you", true).data).toEqual([
      rows[0],
      rows[2],
      LATER_HEADER,
      rows[1],
    ]);
  });

  it("leaves other views and a list with nothing deferred untouched", () => {
    expect(arrangeLater(rows, "tasks", false)).toEqual({ data: rows, laterCount: 0 });
    const plain = [row("a")];
    expect(arrangeLater(plain, "needs_you", false)).toEqual({ data: plain, laterCount: 0 });
  });
});
