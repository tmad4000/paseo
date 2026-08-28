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

const AGENT_ID = "agent-1";

/**
 * Stands in for the shared AgentManager: the queue service only needs the state
 * subscription and the lifecycle of the agent it is draining for.
 */
class FakeAgentController implements AgentQueueAgentController {
  lifecycle: AgentLifecycleStatus = "idle";
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

  emitLifecycle(lifecycle: AgentLifecycleStatus, agentId = AGENT_ID): void {
    this.lifecycle = lifecycle;
    for (const subscriber of this.subscribers) {
      subscriber({ type: "agent_state", agent: { id: agentId, lifecycle } as ManagedAgent });
    }
  }
}

interface Harness {
  service: AgentQueueService;
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

    const service = new AgentQueueService({
      store: new AgentQueueStore(join(dir, "queues")),
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

  test("deleting an agent drops its queue", async () => {
    harness.agents.lifecycle = "running";
    await harness.service.enqueue({ agentId: AGENT_ID, itemId: "item-1", text: "first" });

    await harness.service.deleteForAgent(AGENT_ID);

    expect((await harness.service.list(AGENT_ID)).items).toEqual([]);
  });
});
