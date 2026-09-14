import { describe, expect, test } from "vitest";

import type { AgentQueueSnapshot } from "@getpaseo/protocol/messages";

import {
  flushQueueOutbox,
  QUEUE_OUTBOX_MAX_ATTEMPTS,
  type PendingQueueEnqueue,
  type QueueOutboxAccess,
} from "./model";

function pendingEntry(overrides: Partial<PendingQueueEnqueue> = {}): PendingQueueEnqueue {
  return {
    serverId: "server-1",
    agentId: "agent-1",
    itemId: "item-1",
    text: "hello",
    images: [],
    attachments: [],
    composerAttachments: [],
    createdAt: 1,
    attempts: 0,
    ...overrides,
  };
}

function snapshotWith(...itemIds: string[]): AgentQueueSnapshot {
  return {
    agentId: "agent-1",
    revision: 1,
    items: itemIds.map((id) => ({ id, text: "hello", createdAt: "2026-01-01T00:00:00Z" })),
  };
}

interface Harness {
  outbox: QueueOutboxAccess;
  entries: Map<string, PendingQueueEnqueue>;
  bumped: string[];
}

function createOutbox(initial: PendingQueueEnqueue[]): Harness {
  const entries = new Map(initial.map((entry) => [entry.itemId, entry]));
  const bumped: string[] = [];
  return {
    entries,
    bumped,
    outbox: {
      list: (serverId) =>
        [...entries.values()]
          .filter((entry) => entry.serverId === serverId)
          .sort((a, b) => a.createdAt - b.createdAt),
      remove: (itemId) => {
        entries.delete(itemId);
      },
      bumpAttempts: (itemId) => {
        bumped.push(itemId);
        const entry = entries.get(itemId);
        if (entry) {
          entries.set(itemId, { ...entry, attempts: entry.attempts + 1 });
        }
      },
    },
  };
}

describe("flushQueueOutbox", () => {
  test("re-sends entries oldest first and clears them on ack", async () => {
    const harness = createOutbox([
      pendingEntry({ itemId: "item-2", createdAt: 2 }),
      pendingEntry({ itemId: "item-1", createdAt: 1 }),
    ]);
    const sent: string[] = [];
    const applied: AgentQueueSnapshot[] = [];

    await flushQueueOutbox({
      serverId: "server-1",
      outbox: harness.outbox,
      client: {
        enqueueAgentMessage: async (input) => {
          sent.push(input.itemId);
          return snapshotWith(input.itemId);
        },
      },
      applySnapshot: (snapshot) => applied.push(snapshot),
    });

    expect(sent).toEqual(["item-1", "item-2"]);
    expect(harness.entries.size).toBe(0);
    expect(applied).toHaveLength(2);
  });

  test("only flushes entries for the requested server", async () => {
    const harness = createOutbox([
      pendingEntry({ itemId: "item-1", serverId: "server-1" }),
      pendingEntry({ itemId: "item-2", serverId: "server-2" }),
    ]);
    const sent: string[] = [];

    await flushQueueOutbox({
      serverId: "server-1",
      outbox: harness.outbox,
      client: {
        enqueueAgentMessage: async (input) => {
          sent.push(input.itemId);
          return snapshotWith(input.itemId);
        },
      },
      applySnapshot: () => {},
    });

    expect(sent).toEqual(["item-1"]);
    expect([...harness.entries.keys()]).toEqual(["item-2"]);
  });

  test("a failed send keeps the entry and bumps its attempt count", async () => {
    const harness = createOutbox([pendingEntry()]);

    await flushQueueOutbox({
      serverId: "server-1",
      outbox: harness.outbox,
      client: {
        enqueueAgentMessage: async () => {
          throw new Error("transport not connected");
        },
      },
      applySnapshot: () => {},
    });

    expect(harness.bumped).toEqual(["item-1"]);
    expect(harness.entries.get("item-1")?.attempts).toBe(1);
  });

  test("an entry that exhausts its attempts is dropped and reported", async () => {
    const harness = createOutbox([pendingEntry({ attempts: QUEUE_OUTBOX_MAX_ATTEMPTS - 1 })]);
    const dropped: string[] = [];

    await flushQueueOutbox({
      serverId: "server-1",
      outbox: harness.outbox,
      client: {
        enqueueAgentMessage: async () => {
          throw new Error("still broken");
        },
      },
      applySnapshot: () => {},
      onDropEntry: (entry) => dropped.push(entry.itemId),
    });

    expect(harness.entries.size).toBe(0);
    expect(dropped).toEqual(["item-1"]);
  });
});
