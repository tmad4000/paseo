import { describe, expect, it, vi } from "vitest";
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

const savedStorage = vi.hoisted(() => ({ value: null as string | null }));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => savedStorage.value),
    setItem: vi.fn(async (_key: string, value: string) => {
      savedStorage.value = value;
    }),
    removeItem: vi.fn(async () => {
      savedStorage.value = null;
    }),
  },
}));
import { needsYouIdentity, needsYouRevision, useNeedsYouSeen } from "./needs-you-seen";

it("keeps unseen revisions distinct across hosts and saves only viewed requests", async () => {
  await useNeedsYouSeen.persist.rehydrate();
  useNeedsYouSeen.setState({ seen: {}, hydrated: true });
  const first = row("first");
  const otherHost = { ...first, serverId: "another-host" };
  useNeedsYouSeen.getState().markSeen([first]);
  expect(useNeedsYouSeen.getState().seen[needsYouIdentity(first)]).toBe(needsYouRevision(first));
  expect(useNeedsYouSeen.getState().seen[needsYouIdentity(otherHost)]).toBeUndefined();
  const revised = row("first");
  if (revised.item.kind === "entry") revised.item.entry.text = "Changed question";
  expect(useNeedsYouSeen.getState().seen[needsYouIdentity(revised)]).not.toBe(
    needsYouRevision(revised),
  );
  await useNeedsYouSeen.persist.rehydrate();
  expect(useNeedsYouSeen.getState().seen[needsYouIdentity(first)]).toBe(needsYouRevision(first));
});
