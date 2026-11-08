import { describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  },
}));

import type { CompanionEntry } from "@getpaseo/protocol/companion-stream";
import type { GlobalStreamRow } from "./use-global-stream";
import { groupNeedsYouRows, useNeedsYouGroupsStore } from "./needs-you-groups";

function row(entry: CompanionEntry): GlobalStreamRow {
  return {
    id: entry.id,
    timestamp: entry.timestamp,
    serverId: "host",
    serverLabel: "Host",
    agentId: "agent",
    agentTitle: "Chat",
    cwd: "/p",
    archived: false,
    item: { kind: "entry", entry },
  };
}
const base = { timestamp: "2026-11-03T00:00:00Z", truncated: false };
const question = row({ ...base, id: "question:q", kind: "question", status: "open", text: "Q" });
const permission = row({
  ...base,
  id: "permission:p",
  kind: "permission",
  requestId: "p",
  requestKind: "tool",
  status: "pending",
  text: "Allow push",
});
const blocked = (id: string) =>
  row({
    ...base,
    id: `ask:${id}`,
    kind: "question",
    status: "open",
    text: id,
    ask: {
      state: "blocked",
      remaining: "Needs you",
      evidence: "",
      revision: 1,
      provenance: "explicit",
    },
  });

describe("groupNeedsYouRows", () => {
  it("puts Blocked first, then Questions, then Permissions, with counts", () => {
    const items = groupNeedsYouRows([question, permission, blocked("a"), blocked("b")], []);
    expect(
      items.map((item) => (item.type === "header" ? `${item.group}:${item.count}` : item.row.id)),
    ).toEqual([
      "blocked:2",
      "ask:a",
      "ask:b",
      "question:1",
      "question:q",
      "permission:1",
      "permission:p",
    ]);
  });

  it("keeps a collapsed group's header and count but hides its rows; leaves out empty groups", () => {
    const items = groupNeedsYouRows([question, blocked("a")], ["blocked"]);
    expect(items).toEqual([
      { type: "header", group: "blocked", count: 1, collapsed: true },
      { type: "header", group: "question", count: 1, collapsed: false },
      { type: "row", row: question },
    ]);
  });

  it("remembers collapsed groups in a store", () => {
    useNeedsYouGroupsStore.getState().toggle("blocked");
    expect(useNeedsYouGroupsStore.getState().collapsed).toEqual(["blocked"]);
    useNeedsYouGroupsStore.getState().toggle("blocked");
    expect(useNeedsYouGroupsStore.getState().collapsed).toEqual([]);
  });
});
