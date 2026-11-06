import { expect, it } from "vitest";
import { deduplicateTasks } from "./task-identity";
import { streamCardSource } from "./card-source";
import type { GlobalStreamRow } from "./use-global-stream";
const origin = { serverId: "a", agentId: "source", entryId: "ask:x" };
const row = (serverId: string, revision: number): GlobalStreamRow => ({
  serverId,
  serverLabel: serverId,
  agentId: "source",
  agentTitle: "Source",
  cwd: "/p",
  archived: true,
  timestamp: "2026-10-27",
  id: "source-entry",
  item: {
    kind: "entry",
    entry: {
      kind: "question",
      id: "ask:x",
      text: "Same title",
      timestamp: "2026-10-27",
      truncated: false,
      status: "open",
      ask: {
        state: "open",
        remaining: "Work",
        evidence: "",
        revision,
        provenance: "explicit",
        taskId: "task:x",
        origin,
      },
    },
  },
});
it("chooses the exact canonical origin over a copied record, regardless of copy revision", () => {
  const source = row("a", 2),
    copy = row("b", 10);
  expect(deduplicateTasks([copy, source])).toEqual([source]);
  expect(deduplicateTasks([source, copy])).toEqual([source]);
});
it("does not merge similar legacy tasks across hosts", () => {
  const a = row("a", 2),
    b = row("b", 2);
  if (a.item.kind === "entry") delete a.item.entry.ask!.origin;
  if (b.item.kind === "entry") delete b.item.entry.ask!.origin;
  expect(deduplicateTasks([a, b])).toEqual([a, b]);
});

it("retains a migrated task as a read-only reference when its original host is unavailable", () => {
  const migrated = row("restored-host", 2);
  expect(deduplicateTasks([migrated])).toEqual([migrated]);
  expect(streamCardSource(migrated)).toMatchObject({
    copiedTask: true,
    serverId: "a",
    agentId: "source",
  });
});
