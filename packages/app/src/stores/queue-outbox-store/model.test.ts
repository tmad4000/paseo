import { describe, expect, test } from "vitest";

import type { AgentQueueSnapshot } from "@getpaseo/protocol/messages";

import {
  flushQueueOutbox,
  PendingQueueEnqueueSchema,
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
      get: (itemId) => entries.get(itemId),
      remove: (itemId, preserveRemovalIntent) => {
        if (preserveRemovalIntent && entries.get(itemId)?.removalRequested) return;
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

  test("repeated failures retain the payload and report the retry threshold once", async () => {
    const harness = createOutbox([pendingEntry({ attempts: QUEUE_OUTBOX_MAX_ATTEMPTS - 1 })]);
    const alerts: string[] = [];
    const failingClient = {
      enqueueAgentMessage: async () => {
        throw new Error("still broken");
      },
    };

    await flushQueueOutbox({
      serverId: "server-1",
      outbox: harness.outbox,
      client: failingClient,
      applySnapshot: () => {},
      onRetryLimit: (entry) => alerts.push(entry.itemId),
    });

    expect(harness.entries.get("item-1")?.text).toBe("hello");
    expect(harness.entries.get("item-1")?.attempts).toBe(QUEUE_OUTBOX_MAX_ATTEMPTS);
    expect(alerts).toEqual(["item-1"]);

    await flushQueueOutbox({
      serverId: "server-1",
      outbox: harness.outbox,
      client: failingClient,
      applySnapshot: () => {},
      onRetryLimit: (entry) => alerts.push(entry.itemId),
    });
    expect(harness.entries.get("item-1")?.attempts).toBe(QUEUE_OUTBOX_MAX_ATTEMPTS + 1);
    expect(alerts).toEqual(["item-1"]);

    await flushQueueOutbox({
      serverId: "server-1",
      outbox: harness.outbox,
      client: { enqueueAgentMessage: async () => snapshotWith("item-1") },
      applySnapshot: () => {},
    });
    expect(harness.entries.size).toBe(0);
  });
});

describe("ordered dispatch", () => {
  test("failed A blocks B while another agent proceeds, including a fresh enqueue", async () => {
    const harness = createOutbox([
      pendingEntry({ itemId: "A" }),
      pendingEntry({ itemId: "other", agentId: "agent-2" }),
    ]);
    const calls: string[] = [];
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const input = {
      serverId: "server-1",
      outbox: harness.outbox,
      applySnapshot: () => {},
      client: {
        enqueueAgentMessage: async (entry: { itemId: string; agentId: string }) => {
          calls.push(entry.itemId);
          if (entry.itemId === "A") {
            await waiting;
            throw new Error("offline");
          }
          return { ...snapshotWith(entry.itemId), agentId: entry.agentId };
        },
      },
    };
    const first = flushQueueOutbox(input);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    harness.entries.set("B", pendingEntry({ itemId: "B", createdAt: 2 }));
    const fresh = flushQueueOutbox(input);
    release();
    await Promise.all([first, fresh]);
    expect(calls.filter((id) => id !== "other")).toEqual(["A", "A"]);
    expect(calls).toContain("other");
    expect([...harness.entries.keys()]).toEqual(["A", "B"]);
    const recovered: string[] = [];
    await flushQueueOutbox({
      ...input,
      client: {
        enqueueAgentMessage: async (entry) => {
          recovered.push(entry.itemId);
          return snapshotWith(entry.itemId);
        },
      },
    });
    expect(recovered).toEqual(["A", "B"]);
    expect(harness.entries.size).toBe(0);
  });
});

test("offline cancellation survives serialization and removes prior host acceptance without enqueueing", async () => {
  const entry = pendingEntry({ removalRequested: true });
  const restored = PendingQueueEnqueueSchema.parse(JSON.parse(JSON.stringify(entry)));
  const harness = createOutbox([restored, pendingEntry({ itemId: "second", createdAt: 2 })]);
  const hostItems = new Set([entry.itemId]);
  const operations: string[] = [];
  const client = {
    enqueueAgentMessage: async ({ itemId }: { itemId: string }) => {
      operations.push(`enqueue:${itemId}`);
      hostItems.add(itemId);
      return snapshotWith(...hostItems);
    },
    removeQueuedAgentMessage: async (_agentId: string, itemId: string) => {
      operations.push(`remove:${itemId}`);
      hostItems.delete(itemId);
      return snapshotWith(...hostItems);
    },
  };
  await flushQueueOutbox({
    serverId: "server-1",
    outbox: harness.outbox,
    client,
    applySnapshot: () => {},
  });
  expect(operations).toEqual(["remove:item-1", "enqueue:second"]);
  expect([...hostItems]).toEqual(["second"]);
  expect([...harness.entries]).toEqual([]);
});

test("a failed cancellation remains recoverable and blocks later messages for that agent", async () => {
  const harness = createOutbox([
    pendingEntry({ removalRequested: true }),
    pendingEntry({ itemId: "second", createdAt: 2 }),
  ]);
  const sent: string[] = [];
  await flushQueueOutbox({
    serverId: "server-1",
    outbox: harness.outbox,
    client: {
      enqueueAgentMessage: async ({ itemId }) => {
        sent.push(itemId);
        return snapshotWith(itemId);
      },
      removeQueuedAgentMessage: async () => {
        throw new Error("offline");
      },
    },
    applySnapshot: () => {},
  });
  expect(sent).toEqual([]);
  expect(harness.entries.get("item-1")).toEqual(
    pendingEntry({ removalRequested: true, attempts: 1 }),
  );
  expect([...harness.entries.keys()]).toEqual(["item-1", "second"]);
});

test("a cancellation during an in-flight enqueue removes acceptance before clearing its durable intent", async () => {
  const harness = createOutbox([pendingEntry()]);
  const operations: string[] = [];
  await flushQueueOutbox({
    serverId: "server-1",
    outbox: harness.outbox,
    client: {
      enqueueAgentMessage: async () => {
        operations.push("accepted-response-lost-window");
        harness.entries.set("item-1", pendingEntry({ removalRequested: true }));
        return snapshotWith("item-1");
      },
      removeQueuedAgentMessage: async () => {
        expect(harness.entries.get("item-1")?.removalRequested).toBe(true);
        operations.push("removed");
        return snapshotWith();
      },
    },
    applySnapshot: (snapshot) => {
      expect(snapshot.items).toEqual([]);
    },
  });
  expect(operations).toEqual(["accepted-response-lost-window", "removed"]);
  expect([...harness.entries]).toEqual([]);
});
