import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import { createProviderSnapshotManagerStub } from "../../test-utils/session-stubs.js";
import { AgentQueueService } from "../../agent-queue/service.js";
import { AgentQueueStore } from "../../agent-queue/store.js";
import { MessageReceipts } from "../../message-receipts/index.js";
import type { AgentManager, ManagedAgent } from "../agent-manager.js";
import type { AgentStorage } from "../agent-storage.js";
import type { AgentTimelineItem } from "../agent-sdk-types.js";
import { createPaseoToolCatalog } from "./paseo-tools.js";

const AGENT_ID = "agent-mcp-queue";

describe("agent MCP restart and queue tools", () => {
  let dir: string;
  let lifecycle: "idle" | "running";
  let reloads: number;
  let sent: string[];
  let service: AgentQueueService;
  let catalog: Awaited<ReturnType<typeof createPaseoToolCatalog>>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "paseo-mcp-queue-"));
    lifecycle = "running";
    reloads = 0;
    sent = [];
    const timeline: AgentTimelineItem[] = [];
    const agentManager = {
      subscribe: () => () => undefined,
      getAgent: (id: string) => ({ id, lifecycle }) as ManagedAgent,
      getPendingPermissions: () => [],
      getTimeline: () => timeline,
      reloadAgentSession: async (id: string) => {
        reloads++;
        lifecycle = "idle";
        return { id, lifecycle } as ManagedAgent;
      },
    } as unknown as AgentManager;
    service = new AgentQueueService({
      store: new AgentQueueStore(join(dir, "queues")),
      agentManager,
      agentStorage: {} as AgentStorage,
      logger: createTestLogger(),
      sendPrompt: async ({ messageId }) => {
        sent.push(messageId);
        lifecycle = "running";
      },
    });
    service.setMessageReceipts(new MessageReceipts(join(dir, "agent-requests")));
    service.start();
    catalog = await createPaseoToolCatalog({
      agentManager,
      agentStorage: {} as AgentStorage,
      agentQueueService: service,
      providerSnapshotManager: createProviderSnapshotManagerStub(),
      logger: createTestLogger(),
    });
  });

  afterEach(async () => {
    await service.flushDrains();
    service.stop();
    await rm(dir, { recursive: true, force: true });
  });

  test("registers restart and queue tools", () => {
    for (const name of [
      "restart_agent",
      "list_queue",
      "drain_queue",
      "send_queued_now",
      "remove_queued_message",
      "clear_queue",
    ]) {
      expect(catalog.getTool(name)?.name).toBe(name);
    }
  });

  test("list_queue shows order; restart_agent restarts and delivers the head", async () => {
    await service.enqueue({ agentId: AGENT_ID, itemId: "q1", text: "one" });
    await service.enqueue({ agentId: AGENT_ID, itemId: "q2", text: "two" });

    const listed = await catalog.executeTool("list_queue", { agentId: AGENT_ID });
    expect(listed.structuredContent).toMatchObject({
      agentId: AGENT_ID,
      items: [
        { id: "q1", preview: "one", receipt: null },
        { id: "q2", preview: "two", receipt: null },
      ],
    });

    const restarted = await catalog.executeTool("restart_agent", { agentId: AGENT_ID });
    expect(reloads).toBe(1);
    expect(restarted.structuredContent).toMatchObject({
      agentId: AGENT_ID,
      mode: "reloaded",
      queuedBefore: 2,
      queuedAfter: 1,
      recoveredHead: null,
    });
    expect(sent).toEqual(["q1"]);
  });

  test("drain_queue sends the head of an idle agent; clear_queue empties the rest", async () => {
    await service.enqueue({ agentId: AGENT_ID, itemId: "d1", text: "one" });
    await service.enqueue({ agentId: AGENT_ID, itemId: "d2", text: "two" });
    await service.enqueue({ agentId: AGENT_ID, itemId: "d3", text: "three" });
    lifecycle = "idle";

    const drained = await catalog.executeTool("drain_queue", { agentId: AGENT_ID });
    expect(sent).toEqual(["d1"]);
    expect(
      (drained.structuredContent as { items: Array<{ id: string }> }).items.map((item) => item.id),
    ).toEqual(["d2", "d3"]);

    const cleared = await catalog.executeTool("clear_queue", { agentId: AGENT_ID });
    expect(cleared.structuredContent).toEqual({ removed: 2, kept: 0 });
    expect((await service.list(AGENT_ID)).items).toEqual([]);
  });

  test("restart_agent refuses to restart the calling agent", async () => {
    const selfCatalog = await createPaseoToolCatalog({
      agentManager: { getAgent: () => null } as unknown as AgentManager,
      agentStorage: {} as AgentStorage,
      agentQueueService: service,
      providerSnapshotManager: createProviderSnapshotManagerStub(),
      logger: createTestLogger(),
      callerAgentId: AGENT_ID,
    });
    const outcome = await selfCatalog
      .executeTool("restart_agent", { agentId: AGENT_ID })
      .then((result) => JSON.stringify(result))
      .catch((error: unknown) => String(error));
    expect(outcome).toContain("cannot restart itself");
    expect(reloads).toBe(0);
  });
});
