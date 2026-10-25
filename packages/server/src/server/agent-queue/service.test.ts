import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type { AgentQueueSnapshot } from "@getpaseo/protocol/messages";
import type { AgentLifecycleStatus } from "@getpaseo/protocol/agent-lifecycle";

import { createTestLogger } from "../../test-utils/test-logger.js";
import type { AgentManagerEvent, ManagedAgent } from "../agent/agent-manager.js";
import type { AgentStorage } from "../agent/agent-storage.js";
import {
  AgentQueueService,
  type AgentQueueAgentController,
  type SendQueuedPromptInput,
} from "./service.js";
import { AgentQueueStore } from "./store.js";
import { MessageReceipts } from "../message-receipts/index.js";
import { wrapSpokenInput } from "../voice-config.js";

const AGENT_ID = "agent-1";

/**
 * Stands in for the shared AgentManager: the queue service only needs the state
 * subscription and the lifecycle of the agent it is draining for.
 */
class FakeAgentController implements AgentQueueAgentController {
  lifecycle: AgentLifecycleStatus = "idle";
  pendingPermissions = 0;
  private readonly subscribers = new Set<(event: AgentManagerEvent) => void>();

  subscribe = ((callback: (event: AgentManagerEvent) => void) => {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }) as AgentQueueAgentController["subscribe"];

  getAgent = ((agentId: string) =>
    ({
      id: agentId,
      lifecycle: this.lifecycle,
    }) as ManagedAgent) as AgentQueueAgentController["getAgent"];

  getPendingPermissions = (() =>
    Array.from({ length: this.pendingPermissions }, (_, index) => ({
      id: `permission-${index}`,
    }))) as NonNullable<AgentQueueAgentController["getPendingPermissions"]>;

  emitLifecycle(lifecycle: AgentLifecycleStatus, agentId = AGENT_ID): void {
    this.lifecycle = lifecycle;
    for (const subscriber of this.subscribers) {
      subscriber({ type: "agent_state", agent: { id: agentId, lifecycle } as ManagedAgent });
    }
  }

  resolvePermission(agentId = AGENT_ID): void {
    this.pendingPermissions = 0;
    for (const subscriber of this.subscribers) {
      subscriber({
        type: "agent_stream",
        agentId,
        event: {
          type: "permission_resolved",
          requestId: "permission-0",
          resolution: { behavior: "allow" },
          provider: "codex",
        },
      } as unknown as AgentManagerEvent);
    }
  }
}

interface Harness {
  service: AgentQueueService;
  store: AgentQueueStore;
  agents: FakeAgentController;
  /** Every send the service attempted, including the ones that threw. */
  attempts: SendQueuedPromptInput[];
  sent: SendQueuedPromptInput[];
  broadcasts: AgentQueueSnapshot[];
  failSends: (error: Error | null) => void;
}

describe("AgentQueueService", () => {
  let dir: string;
  let harness: Harness;

  function createHarness(): Harness {
    const agents = new FakeAgentController();
    const attempts: SendQueuedPromptInput[] = [];
    const sent: SendQueuedPromptInput[] = [];
    const broadcasts: AgentQueueSnapshot[] = [];
    let sendError: Error | null = null;

    const store = new AgentQueueStore(join(dir, "queues"));
    const service = new AgentQueueService({
      store,
      agentManager: agents,
      agentStorage: {} as AgentStorage,
      logger: createTestLogger(),
      sendPrompt: async (input) => {
        attempts.push(input);
        if (sendError) {
          throw sendError;
        }
        sent.push(input);
        // A real send starts a turn, so the agent is no longer free to drain.
        agents.lifecycle = "running";
      },
    });
    service.subscribeToMutations((snapshot) => broadcasts.push(snapshot));
    service.start();

    return {
      service,
      store,
      agents,
      attempts,
      sent,
      broadcasts,
      failSends: (error) => {
        sendError = error;
      },
    };
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "paseo-agent-queue-"));
    harness = createHarness();
  });

  afterEach(async () => {
    await harness.service.flushDrains();
    harness.service.stop();
    await rm(dir, { recursive: true, force: true });
  });

  test("destination archival after a completed send preserves its durable retry receipt", async () => {
    const receipts = new MessageReceipts(join(dir, "route-receipts"));
    harness.service.setMessageReceipts(receipts);
    const input = { agentId: AGENT_ID, itemId: "accepted-routing", text: "continue" };
    await harness.service.enqueue(input);
    await harness.service.flushDrains();
    expect(await receipts.get(AGENT_ID, input.itemId)).toBe("completed");
    const retry = await harness.service.enqueue({
      ...input,
      validateDestination: async () => {
        throw new Error("session_route_destination_changed");
      },
    });
    expect(retry.items).toEqual([]);
    expect(harness.sent).toHaveLength(1);
  });

  test("destination guards reject new enqueues but cannot reject an already accepted retry", async () => {
    harness.agents.lifecycle = "running";
    const input = { agentId: AGENT_ID, itemId: "routed", text: "continue" };
    await expect(
      harness.service.enqueue({
        ...input,
        validateDestination: async () => {
          throw new Error("session_route_destination_changed");
        },
      }),
    ).rejects.toThrow("session_route_destination_changed");
    expect((await harness.service.list(AGENT_ID)).items).toEqual([]);
    await harness.service.enqueue(input);
    const retry = await harness.service.enqueue({
      ...input,
      validateDestination: async () => {
        throw new Error("session_route_destination_changed");
      },
    });
    expect(retry.items.map((item) => item.id)).toEqual(["routed"]);
  });

  test("broadcasts the queue to subscribers when an item is enqueued while the agent is busy", async () => {
    harness.agents.lifecycle = "running";

    await harness.service.enqueue({ agentId: AGENT_ID, itemId: "item-1", text: "first" });

    expect(harness.sent).toEqual([]);
    expect(harness.broadcasts).toHaveLength(1);
    expect(harness.broadcasts[0]?.items.map((item) => item.text)).toEqual(["first"]);
  });

  test("a second client reads the same queue the first client wrote", async () => {
    harness.agents.lifecycle = "running";

    await harness.service.enqueue({ agentId: AGENT_ID, itemId: "item-1", text: "from the phone" });

    const asSeenElsewhere = await harness.service.list(AGENT_ID);
    expect(asSeenElsewhere.items.map((item) => item.text)).toEqual(["from the phone"]);
  });

  test("queue survives a service restart", async () => {
    harness.agents.lifecycle = "running";
    await harness.service.enqueue({ agentId: AGENT_ID, itemId: "item-1", text: "persisted" });

    harness.service.stop();
    const restarted = createHarness();
    restarted.agents.lifecycle = "running";
    try {
      const snapshot = await restarted.service.list(AGENT_ID);
      expect(snapshot.items.map((item) => item.text)).toEqual(["persisted"]);
    } finally {
      restarted.service.stop();
    }
  });

  test("drains the head when the agent stops running, with no client involved", async () => {
    harness.agents.lifecycle = "running";
    await harness.service.enqueue({ agentId: AGENT_ID, itemId: "item-1", text: "first" });
    await harness.service.enqueue({ agentId: AGENT_ID, itemId: "item-2", text: "second" });

    harness.agents.emitLifecycle("running");
    harness.agents.emitLifecycle("idle");
    await harness.service.flushDrains();

    expect(harness.sent.map((input) => input.messageId)).toEqual(["item-1"]);
    expect((await harness.service.list(AGENT_ID)).items.map((item) => item.id)).toEqual(["item-2"]);
  });

  test("sends immediately when the agent is already idle", async () => {
    await harness.service.enqueue({ agentId: AGENT_ID, itemId: "item-1", text: "now" });
    await harness.service.flushDrains();

    expect(harness.sent.map((input) => input.messageId)).toEqual(["item-1"]);
    expect((await harness.service.list(AGENT_ID)).items).toEqual([]);
  });

  test("receipt-backed voice and typed messages preserve FIFO and equal spoken utterances", async () => {
    const receipts = new MessageReceipts(join(dir, "agent-requests"));
    harness.service.setMessageReceipts(receipts);
    harness.agents.lifecycle = "running";
    await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "attachment:a",
      text: "same",
      origin: "voice",
    });
    await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "attachment:b",
      text: "same",
      origin: "voice",
    });
    await harness.service.enqueue({ agentId: AGENT_ID, itemId: "typed-1", text: "typed" });
    for (let index = 0; index < 3; index++) {
      harness.agents.emitLifecycle("running");
      harness.agents.emitLifecycle("idle");
      await harness.service.flushDrains();
    }
    expect(harness.sent.map((item) => item.messageId)).toEqual([
      "attachment:a",
      "attachment:b",
      "typed-1",
    ]);
    expect(harness.sent.map((item) => item.prompt)).toEqual([
      wrapSpokenInput("same"),
      wrapSpokenInput("same"),
      "typed",
    ]);
    expect(await receipts.get(AGENT_ID, "attachment:a")).toBe("completed");
    expect((await harness.service.list(AGENT_ID)).items).toEqual([]);
  });

  test("a permission wait holds the receipt-backed head until the keyed resolution", async () => {
    harness.service.setMessageReceipts(new MessageReceipts(join(dir, "agent-requests")));
    harness.agents.pendingPermissions = 1;
    await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "attachment:a",
      text: "yes",
      origin: "voice",
    });
    await harness.service.flushDrains();
    expect(harness.sent).toEqual([]);
    await expect(
      harness.service.waitForPendingDispatch(AGENT_ID, new AbortController().signal),
    ).resolves.toBeUndefined();
    expect(harness.agents.pendingPermissions).toBe(1);
    expect((await harness.service.list(AGENT_ID)).items.map((item) => item.id)).toEqual([
      "attachment:a",
    ]);
    harness.agents.resolvePermission();
    await harness.service.flushDrains();
    expect(harness.sent.map((item) => item.messageId)).toEqual(["attachment:a"]);
  });

  test("permission state resolution without a stream event wakes an idle queue", async () => {
    harness.service.setMessageReceipts(new MessageReceipts(join(dir, "agent-requests")));
    harness.agents.pendingPermissions = 1;
    harness.agents.emitLifecycle("idle");
    await harness.service.enqueue({ agentId: AGENT_ID, itemId: "yes", text: "yes" });
    await harness.service.flushDrains();
    expect(harness.sent).toEqual([]);
    harness.agents.pendingPermissions = 0;
    harness.agents.emitLifecycle("idle");
    await harness.service.flushDrains();
    expect(harness.sent.map((item) => item.messageId)).toEqual(["yes"]);
  });

  test("a pre-upgrade direct-send receipt suppresses a default typed retry", async () => {
    const receipts = new MessageReceipts(join(dir, "agent-requests"));
    await receipts.send({
      agentId: AGENT_ID,
      messageId: "old-direct",
      request: { prompt: "original", activeTurnBehavior: "interrupt" },
      send: async () => {},
    });
    harness.service.setMessageReceipts(receipts);
    await harness.service.enqueue({ agentId: AGENT_ID, itemId: "old-direct", text: "original" });
    await harness.service.flushDrains();
    expect(harness.sent).toEqual([]);
    expect((await harness.service.list(AGENT_ID)).items).toEqual([]);
  });

  test("a competing run retains the head and clears only its pre-provider receipt", async () => {
    const receipts = new MessageReceipts(join(dir, "agent-requests"));
    harness.service.setMessageReceipts(receipts);
    harness.failSends(Object.assign(new Error("Agent busy"), { code: "AGENT_RUN_BUSY" }));
    await harness.service.enqueue({ agentId: AGENT_ID, itemId: "race", text: "follow up" });
    await harness.service.flushDrains();
    expect((await harness.service.list(AGENT_ID)).items.map((item) => item.id)).toEqual(["race"]);
    expect(await receipts.get(AGENT_ID, "race")).toBe("absent");
    harness.failSends(null);
    harness.agents.emitLifecycle("running");
    harness.agents.emitLifecycle("idle");
    await harness.service.flushDrains();
    expect(harness.sent.map((item) => item.messageId)).toEqual(["race"]);
  });

  test("removing admitted speech records an outcome that survives a later retry", async () => {
    const receipts = new MessageReceipts(join(dir, "agent-requests"));
    harness.service.setMessageReceipts(receipts);
    harness.agents.lifecycle = "running";
    await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "attachment:removed",
      text: "cancel this",
      origin: "voice",
    });
    await harness.service.remove(AGENT_ID, "attachment:removed");
    expect(await receipts.get(AGENT_ID, "attachment:removed")).toBe("removed");
    expect((await harness.service.list(AGENT_ID)).items).toEqual([]);
    await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "attachment:removed",
      text: "cancel this",
      origin: "voice",
    });
    expect((await harness.service.list(AGENT_ID)).items).toEqual([]);
    expect(harness.sent).toEqual([]);
  });

  test("a send that fails leaves the message at the front of the queue", async () => {
    harness.agents.lifecycle = "running";
    await harness.service.enqueue({ agentId: AGENT_ID, itemId: "item-1", text: "first" });
    await harness.service.enqueue({ agentId: AGENT_ID, itemId: "item-2", text: "second" });

    harness.failSends(new Error("provider exploded"));
    harness.agents.emitLifecycle("running");
    harness.agents.emitLifecycle("idle");
    await harness.service.flushDrains();

    expect(harness.sent).toEqual([]);
    expect(harness.attempts.length).toBeGreaterThan(0);
    expect((await harness.service.list(AGENT_ID)).items.map((item) => item.id)).toEqual([
      "item-1",
      "item-2",
    ]);
  });

  test("a dispatch observer reports an unknown outcome without retrying it", async () => {
    const receipts = new MessageReceipts(join(dir, "agent-requests"));
    harness.service.setMessageReceipts(receipts);
    harness.failSends(new Error("provider accepted, connection lost"));
    await harness.service.enqueue({ agentId: AGENT_ID, itemId: "uncertain", text: "once" });
    await expect(
      harness.service.waitForPendingDispatch(AGENT_ID, new AbortController().signal),
    ).rejects.toThrow("not been confirmed submitted");
    expect(await receipts.get(AGENT_ID, "uncertain")).toBe("pending");
    expect(harness.attempts).toHaveLength(1);
    expect((await harness.service.list(AGENT_ID)).items.map((item) => item.id)).toEqual([
      "uncertain",
    ]);
  });

  test("removing an item broadcasts the shorter queue", async () => {
    harness.agents.lifecycle = "running";
    await harness.service.enqueue({ agentId: AGENT_ID, itemId: "item-1", text: "first" });
    await harness.service.enqueue({ agentId: AGENT_ID, itemId: "item-2", text: "second" });
    harness.broadcasts.length = 0;

    await harness.service.remove(AGENT_ID, "item-1");

    expect(harness.broadcasts).toHaveLength(1);
    expect(harness.broadcasts[0]?.items.map((item) => item.id)).toEqual(["item-2"]);
  });

  test("removing an unknown item changes nothing and broadcasts nothing", async () => {
    harness.agents.lifecycle = "running";
    await harness.service.enqueue({ agentId: AGENT_ID, itemId: "item-1", text: "first" });
    harness.broadcasts.length = 0;

    const snapshot = await harness.service.remove(AGENT_ID, "does-not-exist");

    expect(snapshot.items.map((item) => item.id)).toEqual(["item-1"]);
    expect(harness.broadcasts).toEqual([]);
  });

  test("editing changes only the text, preserving queue order and message identity", async () => {
    harness.agents.lifecycle = "running";
    await harness.service.enqueue({ agentId: AGENT_ID, itemId: "item-1", text: "first" });
    await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "item-2",
      text: "second",
      images: [{ data: "aGVsbG8=", mimeType: "image/png" }],
    });
    const before = await harness.store.get(AGENT_ID);
    harness.broadcasts.length = 0;

    const after = await harness.service.edit(AGENT_ID, "item-2", "second", "  revised  ");
    const stored = await harness.store.get(AGENT_ID);

    expect(after.items.map((item) => [item.id, item.text, item.createdAt])).toEqual([
      ["item-1", "first", before.items[0]?.createdAt],
      ["item-2", "revised", before.items[1]?.createdAt],
    ]);
    expect(stored.items[1]?.images).toEqual(before.items[1]?.images);
    expect(harness.broadcasts).toEqual([after]);
    expect(after.revision).toBe(before.revision + 1);
  });

  test("a stale or already-drained edit cannot overwrite a queued message", async () => {
    harness.agents.lifecycle = "running";
    await harness.service.enqueue({ agentId: AGENT_ID, itemId: "item-1", text: "original" });
    await harness.service.edit(AGENT_ID, "item-1", "original", "new text");

    await expect(
      harness.service.edit(AGENT_ID, "item-1", "original", "stale text"),
    ).rejects.toThrow(/changed on another device/);
    await expect(harness.service.edit(AGENT_ID, "item-1", "new text", "   ")).rejects.toThrow(
      /cannot be empty/,
    );
    expect((await harness.service.list(AGENT_ID)).items[0]?.text).toBe("new text");

    await harness.service.remove(AGENT_ID, "item-1");
    await expect(harness.service.edit(AGENT_ID, "item-1", "new text", "too late")).rejects.toThrow(
      /no longer queued/,
    );
  });

  test("a drain sends the latest edit even if it read the queue just before the edit", async () => {
    harness.agents.lifecycle = "running";
    await harness.service.enqueue({ agentId: AGENT_ID, itemId: "item-1", text: "old text" });
    await harness.service.flushDrains();

    const originalGet = harness.store.get.bind(harness.store);
    let injectEdit = true;
    harness.store.get = async (agentId) => {
      const snapshot = await originalGet(agentId);
      if (injectEdit && snapshot.items[0]?.id === "item-1") {
        injectEdit = false;
        await harness.service.edit(agentId, "item-1", "old text", "latest text");
      }
      return snapshot;
    };

    harness.agents.emitLifecycle("running");
    harness.agents.emitLifecycle("idle");
    await harness.service.flushDrains();
    expect(harness.sent[0]?.prompt).toBe("latest text");
  });

  test("send-now claims the latest daemon text exactly once across competing devices", async () => {
    harness.agents.lifecycle = "running";
    await harness.service.enqueue({ agentId: AGENT_ID, itemId: "item-1", text: "old text" });
    await harness.service.edit(AGENT_ID, "item-1", "old text", "edited elsewhere");

    const results = await Promise.allSettled([
      harness.service.sendNow(AGENT_ID, "item-1"),
      harness.service.sendNow(AGENT_ID, "item-1"),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(harness.sent).toHaveLength(1);
    expect(harness.sent[0]?.prompt).toBe("edited elsewhere");
    expect(harness.sent[0]?.activeTurnBehavior).toBe("steer_only");
    expect((await harness.service.list(AGENT_ID)).items).toEqual([]);
  });

  test("a refused strict steer restores the same queued item at its original position", async () => {
    harness.agents.lifecycle = "running";
    await harness.service.enqueue({ agentId: AGENT_ID, itemId: "item-1", text: "first" });
    await harness.service.enqueue({ agentId: AGENT_ID, itemId: "item-2", text: "second" });
    harness.failSends(new Error("steer refused"));

    await expect(harness.service.sendNow(AGENT_ID, "item-1")).rejects.toThrow("steer refused");

    expect((await harness.service.list(AGENT_ID)).items.map((item) => item.id)).toEqual([
      "item-1",
      "item-2",
    ]);
    expect(harness.sent).toEqual([]);
  });

  test("receipt-backed send-now sends the latest edit and records completion before removal", async () => {
    const receipts = new MessageReceipts(join(dir, "agent-requests"));
    harness.service.setMessageReceipts(receipts);
    harness.agents.lifecycle = "running";
    await harness.service.enqueue({ agentId: AGENT_ID, itemId: "item-1", text: "old" });
    await harness.service.edit(AGENT_ID, "item-1", "old", "latest");

    await harness.service.sendNow(AGENT_ID, "item-1");

    expect(harness.sent.map((attempt) => attempt.prompt)).toEqual(["latest"]);
    expect(harness.sent[0]?.activeTurnBehavior).toBe("steer_only");
    expect(await receipts.get(AGENT_ID, "item-1")).toBe("completed");
    expect((await harness.service.list(AGENT_ID)).items).toEqual([]);
  });

  test("receipt-backed drain sends the latest edit after reading an older snapshot", async () => {
    const receipts = new MessageReceipts(join(dir, "agent-requests"));
    harness.service.setMessageReceipts(receipts);
    harness.agents.lifecycle = "running";
    await harness.service.enqueue({ agentId: AGENT_ID, itemId: "item-1", text: "old" });
    await harness.service.flushDrains();

    const originalGet = harness.store.get.bind(harness.store);
    let injectEdit = true;
    harness.store.get = async (agentId) => {
      const snapshot = await originalGet(agentId);
      if (injectEdit && snapshot.items[0]?.id === "item-1") {
        injectEdit = false;
        await harness.service.edit(agentId, "item-1", "old", "latest");
      }
      return snapshot;
    };

    harness.agents.emitLifecycle("running");
    harness.agents.emitLifecycle("idle");
    await harness.service.flushDrains();
    expect(harness.sent[0]?.prompt).toBe("latest");
  });

  test("a cancelled pre-submission start does not poison the queue receipt", async () => {
    const receipts = new MessageReceipts(join(dir, "agent-requests"));
    harness.service.setMessageReceipts(receipts);
    harness.failSends(
      Object.assign(new Error("cancelled before submission"), {
        code: "AGENT_PROMPT_NOT_SUBMITTED",
      }),
    );
    await harness.service.enqueue({ agentId: AGENT_ID, itemId: "notice", text: "notification" });
    await harness.service.flushDrains();
    expect(await receipts.get(AGENT_ID, "notice")).toBe("absent");
    expect((await harness.service.list(AGENT_ID)).items.map((item) => item.id)).toEqual(["notice"]);

    harness.agents.emitLifecycle("running");
    await harness.service.enqueue({ agentId: AGENT_ID, itemId: "question", text: "follow-up" });
    await harness.service.flushDrains();
    harness.failSends(null);
    harness.agents.emitLifecycle("idle");
    await harness.service.flushDrains();
    expect(await receipts.get(AGENT_ID, "notice")).toBe("completed");
    expect((await harness.service.list(AGENT_ID)).items.map((item) => item.id)).toEqual([
      "question",
    ]);

    harness.agents.emitLifecycle("running");
    harness.agents.emitLifecycle("idle");
    await harness.service.flushDrains();
    expect(harness.sent.map((item) => item.messageId)).toEqual(["notice", "question"]);
    expect((await harness.service.list(AGENT_ID)).items).toEqual([]);
  });

  test("receipt-backed refused steer stays queued and can be edited", async () => {
    const receipts = new MessageReceipts(join(dir, "agent-requests"));
    harness.service.setMessageReceipts(receipts);
    harness.agents.lifecycle = "running";
    await harness.service.enqueue({ agentId: AGENT_ID, itemId: "item-1", text: "first" });
    await harness.service.enqueue({ agentId: AGENT_ID, itemId: "item-2", text: "second" });
    harness.failSends(
      Object.assign(new Error("steer refused"), { code: "AGENT_PROMPT_NOT_SUBMITTED" }),
    );

    await expect(harness.service.sendNow(AGENT_ID, "item-1")).rejects.toThrow("steer refused");
    expect(await receipts.get(AGENT_ID, "item-1")).toBe("absent");
    await harness.service.edit(AGENT_ID, "item-1", "first", "revised");
    expect((await harness.service.list(AGENT_ID)).items.map((item) => item.text)).toEqual([
      "revised",
      "second",
    ]);
  });

  test("uncertain receipt-backed send-now keeps the item queued without retrying it", async () => {
    const receipts = new MessageReceipts(join(dir, "agent-requests"));
    harness.service.setMessageReceipts(receipts);
    harness.agents.lifecycle = "running";
    await harness.service.enqueue({ agentId: AGENT_ID, itemId: "item-1", text: "once" });
    harness.failSends(new Error("provider outcome unknown"));

    await expect(harness.service.sendNow(AGENT_ID, "item-1")).rejects.toThrow(
      "provider outcome unknown",
    );

    expect(await receipts.get(AGENT_ID, "item-1")).toBe("pending");
    expect((await harness.service.list(AGENT_ID)).items.map((item) => item.id)).toEqual(["item-1"]);
    await expect(harness.service.edit(AGENT_ID, "item-1", "once", "changed")).rejects.toThrow(
      "already being submitted",
    );
    await expect(harness.service.sendNow(AGENT_ID, "item-1")).rejects.toThrow(
      "agent_request_outcome_unknown",
    );
    expect(harness.attempts).toHaveLength(1);
  });

  test("revision increases monotonically across mutations", async () => {
    harness.agents.lifecycle = "running";
    const first = await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "item-1",
      text: "first",
    });
    const second = await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "item-2",
      text: "second",
    });
    const afterRemovingBoth = await harness.service.remove(AGENT_ID, "item-1");
    const emptied = await harness.service.remove(AGENT_ID, "item-2");
    const refilled = await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "item-3",
      text: "third",
    });

    expect(emptied.items).toEqual([]);
    expect([
      first.revision,
      second.revision,
      afterRemovingBoth.revision,
      emptied.revision,
      refilled.revision,
    ]).toEqual([1, 2, 3, 4, 5]);
  });

  test("reorder moves an item to the front and leaves unmentioned ids at the end", async () => {
    harness.agents.lifecycle = "running";
    await harness.service.enqueue({ agentId: AGENT_ID, itemId: "item-1", text: "first" });
    await harness.service.enqueue({ agentId: AGENT_ID, itemId: "item-2", text: "second" });
    await harness.service.enqueue({ agentId: AGENT_ID, itemId: "item-3", text: "third" });

    const snapshot = await harness.service.reorder(AGENT_ID, ["item-3", "item-1"]);

    expect(snapshot.items.map((item) => item.id)).toEqual(["item-3", "item-1", "item-2"]);
  });

  test("image bytes are stored but never broadcast", async () => {
    harness.agents.lifecycle = "running";

    const snapshot = await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "item-1",
      text: "look at this",
      images: [{ data: "AAAA", mimeType: "image/png" }],
    });

    const image = snapshot.items[0]?.images?.[0];
    expect(image).toMatchObject({ mimeType: "image/png", byteSize: 3 });
    expect(JSON.stringify(snapshot)).not.toContain("AAAA");
  });

  test("queued images reach the agent as prompt image blocks on drain", async () => {
    harness.agents.lifecycle = "running";
    await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "item-1",
      text: "look at this",
      images: [{ data: "AAAA", mimeType: "image/png" }],
    });

    harness.agents.emitLifecycle("running");
    harness.agents.emitLifecycle("idle");
    await harness.service.flushDrains();

    expect(harness.sent[0]?.prompt).toEqual([
      { type: "text", text: "look at this" },
      { type: "image", data: "AAAA", mimeType: "image/png" },
    ]);
  });

  test("rejects an empty message", async () => {
    await expect(
      harness.service.enqueue({ agentId: AGENT_ID, itemId: "item-1", text: "   " }),
    ).rejects.toThrow(/empty/i);
  });

  test("re-enqueueing the same id is a retry, not a duplicate", async () => {
    harness.agents.lifecycle = "running";
    await harness.service.enqueue({ agentId: AGENT_ID, itemId: "item-1", text: "first" });
    const snapshot = await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "item-1",
      text: "first",
    });

    expect(snapshot.items.map((item) => item.id)).toEqual(["item-1"]);
  });

  test("an enqueue retry that lands after the item drained does not resend it", async () => {
    await harness.service.enqueue({ agentId: AGENT_ID, itemId: "item-1", text: "once" });
    await harness.service.flushDrains();
    expect(harness.sent.map((input) => input.messageId)).toEqual(["item-1"]);

    // The client never saw the ack (e.g. relay dropped mid-request) and retries
    // after reconnect. The daemon already delivered the item.
    harness.agents.lifecycle = "idle";
    const snapshot = await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "item-1",
      text: "once",
    });
    await harness.service.flushDrains();

    expect(snapshot.items).toEqual([]);
    expect(harness.sent.map((input) => input.messageId)).toEqual(["item-1"]);
  });

  test("a send failure clears the drained marker so the item can drain again", async () => {
    harness.agents.lifecycle = "running";
    await harness.service.enqueue({ agentId: AGENT_ID, itemId: "item-1", text: "flaky" });

    harness.failSends(new Error("provider exploded"));
    harness.agents.emitLifecycle("running");
    harness.agents.emitLifecycle("idle");
    await harness.service.flushDrains();
    expect(harness.sent).toEqual([]);

    harness.failSends(null);
    harness.agents.emitLifecycle("running");
    harness.agents.emitLifecycle("idle");
    await harness.service.flushDrains();

    expect(harness.sent.map((input) => input.messageId)).toEqual(["item-1"]);
  });

  test("deleting an agent drops its queue", async () => {
    harness.agents.lifecycle = "running";
    await harness.service.enqueue({ agentId: AGENT_ID, itemId: "item-1", text: "first" });

    await harness.service.deleteForAgent(AGENT_ID);

    expect((await harness.service.list(AGENT_ID)).items).toEqual([]);
  });
});
