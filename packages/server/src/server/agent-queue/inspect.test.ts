import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type { AgentLifecycleStatus } from "@getpaseo/protocol/agent-lifecycle";

import { createTestLogger } from "../../test-utils/test-logger.js";
import type { AgentManagerEvent, ManagedAgent } from "../agent/agent-manager.js";
import type { AgentStorage } from "../agent/agent-storage.js";
import { MessageReceipts } from "../message-receipts/index.js";
import { AgentQueueService, type AgentQueueAgentController } from "./service.js";
import { AgentQueueStore, reconcileDrainedLog, type StoredAgentQueue } from "./store.js";

const AGENT_ID = "agent-1";

class FakeAgents implements AgentQueueAgentController {
  lifecycle: AgentLifecycleStatus = "running";
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

  emitLifecycle(lifecycle: AgentLifecycleStatus): void {
    this.lifecycle = lifecycle;
    for (const subscriber of this.subscribers) {
      subscriber({ type: "agent_state", agent: { id: AGENT_ID, lifecycle } as ManagedAgent });
    }
  }
}

function queue(overrides: Partial<StoredAgentQueue>): StoredAgentQueue {
  return { agentId: AGENT_ID, revision: 0, items: [], ...overrides };
}

describe("reconcileDrainedLog", () => {
  test("stamps a newly drained item with a one-line preview", () => {
    const before = queue({
      items: [{ id: "a", text: "first line\n  second line", createdAt: "2026-10-22T00:00:00Z" }],
    });
    const after = queue({ drainedIds: ["a"] });

    expect(reconcileDrainedLog(before, after, "2026-10-22T01:00:00Z")).toEqual([
      { id: "a", drainedAt: "2026-10-22T01:00:00Z", preview: "first line second line" },
    ]);
  });

  test("forgets an item whose drain failed and was restored", () => {
    const before = queue({
      drainedIds: ["a"],
      drainedLog: [{ id: "a", drainedAt: "t", preview: "x" }],
    });
    const after = queue({ drainedIds: [], drainedLog: before.drainedLog });

    expect(reconcileDrainedLog(before, after, "later")).toBeUndefined();
  });

  test("keeps earlier entries untouched", () => {
    const log = [{ id: "a", drainedAt: "t1", preview: "x" }];
    const before = queue({
      drainedIds: ["a"],
      drainedLog: log,
      items: [{ id: "b", text: "next", createdAt: "c" }],
    });
    const after = queue({ drainedIds: ["a", "b"], drainedLog: log });

    expect(reconcileDrainedLog(before, after, "t2")).toEqual([
      ...log,
      { id: "b", drainedAt: "t2", preview: "next" },
    ]);
  });
});

describe("AgentQueueService.inspect", () => {
  let dir: string;
  let agents: FakeAgents;
  let service: AgentQueueService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "paseo-queue-inspect-"));
    agents = new FakeAgents();
    service = new AgentQueueService({
      store: new AgentQueueStore(join(dir, "queues")),
      agentManager: agents,
      agentStorage: {} as AgentStorage,
      logger: createTestLogger(),
      sendPrompt: async () => {
        agents.lifecycle = "running";
      },
    });
    service.setMessageReceipts(new MessageReceipts(join(dir, "receipts")));
    service.start();
  });

  afterEach(async () => {
    await service.flushDrains();
    service.stop();
    await rm(dir, { recursive: true, force: true });
  });

  test("shows a waiting item, then its delivery time and receipt once drained", async () => {
    agents.emitLifecycle("running");
    await service.enqueue({ agentId: AGENT_ID, itemId: "m1", text: "check the logs" });

    const waiting = await service.inspect(AGENT_ID);
    expect(waiting.queue.items.map((item) => item.id)).toEqual(["m1"]);
    expect(waiting.drained).toEqual([]);

    agents.emitLifecycle("idle");
    await service.flushDrains();

    const delivered = await service.inspect(AGENT_ID);
    expect(delivered.queue.items).toEqual([]);
    expect(delivered.drained).toEqual([
      { id: "m1", drainedAt: expect.any(String), preview: "check the logs" },
    ]);
    expect(delivered.receipts).toEqual([
      { messageId: "m1", state: "completed", createdAt: expect.any(String) },
    ]);
  });

  test("reports each device's latest unsent counts for the inspected agent", async () => {
    service.recordOutboxReport({
      clientId: "phone",
      deviceLabel: "iPhone",
      platform: "ios",
      reportedAt: "2026-10-22T01:00:00Z",
      agents: [{ agentId: AGENT_ID, unsentQueued: 2, unsentDirect: 1, oldestCreatedAt: "t0" }],
    });
    service.recordOutboxReport({
      clientId: "desktop",
      deviceLabel: "Desktop app",
      platform: "desktop",
      reportedAt: "2026-10-22T02:00:00Z",
      agents: [{ agentId: "other-agent", unsentQueued: 5, unsentDirect: 0, oldestCreatedAt: null }],
    });
    service.recordOutboxReport({
      clientId: "phone",
      deviceLabel: "iPhone",
      platform: "ios",
      reportedAt: "2026-10-22T03:00:00Z",
      agents: [{ agentId: AGENT_ID, unsentQueued: 0, unsentDirect: 1, oldestCreatedAt: "t1" }],
    });

    const { deviceReports } = await service.inspect(AGENT_ID);

    expect(deviceReports).toEqual([
      {
        clientId: "phone",
        deviceLabel: "iPhone",
        platform: "ios",
        reportedAt: "2026-10-22T03:00:00Z",
        unsentQueued: 0,
        unsentDirect: 1,
        oldestCreatedAt: "t1",
      },
      {
        clientId: "desktop",
        deviceLabel: "Desktop app",
        platform: "desktop",
        reportedAt: "2026-10-22T02:00:00Z",
        unsentQueued: 0,
        unsentDirect: 0,
        oldestCreatedAt: null,
      },
    ]);
  });
});
