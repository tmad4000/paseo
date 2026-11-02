import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { AgentLifecycleStatus } from "@getpaseo/protocol/agent-lifecycle";

import { createTestLogger } from "../../test-utils/test-logger.js";
import type { AgentManagerEvent, ManagedAgent } from "../agent/agent-manager.js";
import type { AgentStorage } from "../agent/agent-storage.js";
import type { AgentTimelineItem } from "../agent/agent-sdk-types.js";
import { restartAgentCommand, timelineHasQueuedMessage } from "../agent/restart-agent.js";
import { MessageReceipts } from "../message-receipts/index.js";
import {
  AgentQueueService,
  type AgentQueueAgentController,
  type SendQueuedPromptInput,
} from "./service.js";
import { AgentQueueStore } from "./store.js";

const AGENT_ID = "agent-stuck";

/** The queue only needs lifecycle + state events; restart also needs reload and timeline. */
class FakeAgents implements AgentQueueAgentController {
  lifecycle: AgentLifecycleStatus = "idle";
  timeline: AgentTimelineItem[] = [];
  live = true;
  reloads = 0;
  loads = 0;
  private readonly subscribers = new Set<(event: AgentManagerEvent) => void>();

  subscribe = ((callback: (event: AgentManagerEvent) => void) => {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }) as AgentQueueAgentController["subscribe"];

  getAgent = ((agentId: string) =>
    this.live
      ? ({ id: agentId, lifecycle: this.lifecycle } as ManagedAgent)
      : null) as unknown as AgentQueueAgentController["getAgent"];

  getPendingPermissions = (() => []) as NonNullable<
    AgentQueueAgentController["getPendingPermissions"]
  >;

  getTimeline = (_agentId: string) => this.timeline;

  reloadAgentSession = async (agentId: string) => {
    this.reloads++;
    this.lifecycle = "idle";
    return { id: agentId, lifecycle: "idle" } as ManagedAgent;
  };

  emitLifecycle(lifecycle: AgentLifecycleStatus): void {
    this.lifecycle = lifecycle;
    for (const subscriber of this.subscribers) {
      subscriber({ type: "agent_state", agent: { id: AGENT_ID, lifecycle } as ManagedAgent });
    }
  }

  /** One provider turn: running → idle, which drains the next item. */
  finishTurn(): void {
    this.emitLifecycle("running");
    this.emitLifecycle("idle");
  }
}

describe("Restart agent recovers a stuck queue", () => {
  let dir: string;
  let agents: FakeAgents;
  let store: AgentQueueStore;
  let receipts: MessageReceipts;
  let sent: SendQueuedPromptInput[];
  let sendError: Error | null;

  function createService(): AgentQueueService {
    const service = new AgentQueueService({
      store,
      agentManager: agents,
      agentStorage: {} as AgentStorage,
      logger: createTestLogger(),
      sendPrompt: async (input) => {
        if (sendError) throw sendError;
        sent.push(input);
        agents.timeline.push({ type: "user_message", text: "", clientMessageId: input.messageId });
        agents.lifecycle = "running";
      },
    });
    service.setMessageReceipts(receipts);
    service.start();
    return service;
  }

  function restart(service: AgentQueueService) {
    return restartAgentCommand(
      {
        agentManager: agents as never,
        agentQueueService: service,
        loadAgent: async (agentId) => {
          agents.loads++;
          agents.live = true;
          return { id: agentId, lifecycle: "idle" } as ManagedAgent;
        },
        logger: createTestLogger(),
      },
      AGENT_ID,
    );
  }

  /**
   * Reproduces Paseo 073a1f54 (2026-10-28): the head's send died mid-submit and
   * left a `pending` receipt; later messages queued behind it; the daemon
   * restarted, so nothing remembers the attempt and nothing retries it.
   */
  async function strandQueue(): Promise<AgentQueueService> {
    const first = createService();
    sendError = new Error("daemon died mid-submit");
    await first.enqueue({ agentId: AGENT_ID, itemId: "m1", text: "first" });
    await first.flushDrains();
    expect(await receipts.get(AGENT_ID, "m1")).toBe("pending");
    sendError = null;
    for (const id of ["m2", "m3", "m4"]) {
      await first.enqueue({ agentId: AGENT_ID, itemId: id, text: id });
    }
    await first.flushDrains();
    first.stop();

    // The daemon comes back. A fresh receipts owner has no memory of the send.
    receipts = new MessageReceipts(join(dir, "agent-requests"));
    agents.lifecycle = "idle";
    return createService();
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "paseo-restart-recovery-"));
    agents = new FakeAgents();
    store = new AgentQueueStore(join(dir, "queues"));
    receipts = new MessageReceipts(join(dir, "agent-requests"));
    sent = [];
    sendError = null;
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("the stuck state is real: idle edges and drain alone never move the queue", async () => {
    const service = await strandQueue();
    agents.finishTurn();
    await service.drainNow(AGENT_ID);
    await service.flushDrains();
    expect(sent).toEqual([]);
    expect((await service.list(AGENT_ID)).items.map((item) => item.id)).toEqual([
      "m1",
      "m2",
      "m3",
      "m4",
    ]);
    service.stop();
  });

  test("restart resends an undelivered stuck head and then delivers the rest in order", async () => {
    const service = await strandQueue();

    const result = await restart(service);
    expect(agents.reloads).toBe(1);
    expect(result.mode).toBe("reloaded");
    expect(result.queue?.before).toBe(4);
    expect(result.queue?.recoveredHead).toEqual({ itemId: "m1", outcome: "resend" });
    expect(sent.map((item) => item.messageId)).toEqual(["m1"]);

    for (let turn = 0; turn < 3; turn++) {
      agents.finishTurn();
      await service.flushDrains();
    }
    expect(sent.map((item) => item.messageId)).toEqual(["m1", "m2", "m3", "m4"]);
    expect((await service.list(AGENT_ID)).items).toEqual([]);
    for (const id of ["m1", "m2", "m3", "m4"]) {
      expect(await receipts.get(AGENT_ID, id)).toBe("completed");
    }
    service.stop();
  });

  test("restart does not resend a stuck head the agent already received", async () => {
    const service = await strandQueue();
    // The provider accepted m1 before the daemon died; the timeline kept its id.
    agents.timeline.push({ type: "user_message", text: "first", clientMessageId: "m1" });

    const result = await restart(service);
    expect(result.queue?.recoveredHead).toEqual({ itemId: "m1", outcome: "delivered" });
    expect(await receipts.get(AGENT_ID, "m1")).toBe("completed");
    expect(sent.map((item) => item.messageId)).toEqual(["m2"]);

    for (let turn = 0; turn < 2; turn++) {
      agents.finishTurn();
      await service.flushDrains();
    }
    expect(sent.map((item) => item.messageId)).toEqual(["m2", "m3", "m4"]);
    const inspection = await service.inspect(AGENT_ID);
    expect(inspection.drained.map((item) => item.id)).toContain("m1");
    service.stop();
  });

  test("restart drains a queue left on an idle agent with no receipt problem", async () => {
    agents.lifecycle = "running";
    const first = createService();
    await first.enqueue({ agentId: AGENT_ID, itemId: "a", text: "a" });
    await first.enqueue({ agentId: AGENT_ID, itemId: "b", text: "b" });
    first.stop();
    // Daemon restart while the agent was "running": it comes back idle, no edge.
    agents.lifecycle = "idle";
    const service = createService();

    const result = await restart(service);
    expect(result.queue?.recoveredHead).toBeNull();
    agents.finishTurn();
    await service.flushDrains();
    expect(sent.map((item) => item.messageId)).toEqual(["a", "b"]);
    service.stop();
  });

  test("restart loads an agent that is not live instead of reloading it", async () => {
    agents.live = false;
    const service = createService();
    const result = await restart(service);
    expect(result.mode).toBe("resumed");
    expect(agents.loads).toBe(1);
    expect(agents.reloads).toBe(0);
    expect(result.queue?.before).toBe(0);
    service.stop();
  });

  test("a send still in flight on this daemon is never settled as stale", async () => {
    let release: () => void = () => undefined;
    const service = new AgentQueueService({
      store,
      agentManager: agents,
      agentStorage: {} as AgentStorage,
      logger: createTestLogger(),
      sendPrompt: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    });
    service.setMessageReceipts(receipts);
    service.start();
    await service.enqueue({ agentId: AGENT_ID, itemId: "slow", text: "slow" });
    await vi.waitFor(async () => expect(await receipts.get(AGENT_ID, "slow")).toBe("pending"));

    expect(await service.recoverStalledHead(AGENT_ID, () => false)).toBeNull();
    expect(await receipts.get(AGENT_ID, "slow")).toBe("pending");
    release();
    await service.flushDrains();
    expect(await receipts.get(AGENT_ID, "slow")).toBe("completed");
    service.stop();
  });

  test("clear removes queued items and keeps none sendable afterwards", async () => {
    agents.lifecycle = "running";
    const service = createService();
    for (const id of ["x", "y", "z"]) {
      await service.enqueue({ agentId: AGENT_ID, itemId: id, text: id });
    }
    const result = await service.clear(AGENT_ID);
    expect(result).toMatchObject({ removed: 3, kept: 0 });
    expect(result.queue.items).toEqual([]);
    agents.finishTurn();
    await service.flushDrains();
    expect(sent).toEqual([]);
    service.stop();
  });
});

describe("timelineHasQueuedMessage", () => {
  test("matches the drain's clientMessageId or a canonical messageId, not text", () => {
    const timeline: AgentTimelineItem[] = [
      { type: "user_message", text: "continue", clientMessageId: "id-1" },
      { type: "user_message", text: "continue", messageId: "id-2" },
      { type: "assistant_message", text: "ok", messageId: "id-3" },
    ];
    expect(timelineHasQueuedMessage(timeline, { id: "id-1" })).toBe(true);
    expect(timelineHasQueuedMessage(timeline, { id: "id-2" })).toBe(true);
    expect(timelineHasQueuedMessage(timeline, { id: "id-3" })).toBe(false);
    expect(timelineHasQueuedMessage(timeline, { id: "continue" })).toBe(false);
  });
});
