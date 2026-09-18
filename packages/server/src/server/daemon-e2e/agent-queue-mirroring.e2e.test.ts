import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { AgentQueueSnapshot } from "@getpaseo/protocol/messages";
import { createDaemonTestContext, type DaemonTestContext } from "../test-utils/index.js";
import { DaemonClient } from "../test-utils/daemon-client.js";

/**
 * The point of the daemon-owned queue: a message queued on one device shows up on
 * every other device connected to the same daemon, and the daemon sends it when
 * the agent frees up. See docs/queue-mirroring.md.
 *
 * These tests park the agent on a pending permission so the queue is observable.
 * An idle agent drains immediately, which is correct but leaves nothing to look at.
 */
describe("agent message queue mirroring", () => {
  let ctx: DaemonTestContext;
  let secondDevice: DaemonClient;
  let cwd: string;
  const queueEventSubscriptions: { release: () => Promise<void> }[] = [];

  /** Subscribe a device to queue updates so the daemon mirrors them to it. */
  async function observeQueueUpdates(client: DaemonClient): Promise<void> {
    const subscription = client.observeEvents(["agent.queue.update"]);
    subscription.subscribe({ snapshot: () => {}, update: () => {} });
    await subscription.ready;
    queueEventSubscriptions.push(subscription);
  }

  beforeEach(async () => {
    ctx = await createDaemonTestContext();
    secondDevice = new DaemonClient({ url: `ws://127.0.0.1:${ctx.daemon.port}/ws` });
    await secondDevice.connect();
    await secondDevice.fetchAgents({ subscribe: {} });
    await observeQueueUpdates(ctx.client);
    await observeQueueUpdates(secondDevice);
    cwd = mkdtempSync(path.join(tmpdir(), "queue-mirroring-e2e-"));
    writeFileSync(path.join(cwd, "permission.txt"), "ok", "utf8");
  }, 30000);

  afterEach(async () => {
    for (const subscription of queueEventSubscriptions.splice(0)) {
      await subscription.release().catch(() => undefined);
    }
    await secondDevice?.close();
    if (ctx) await ctx.cleanup();
    if (cwd) rmSync(cwd, { recursive: true, force: true });
  }, 30000);

  /** Leaves the agent waiting on a permission, so it is busy and cannot drain. */
  async function createBusyAgent(): Promise<{ id: string; permissionId: string }> {
    const agent = await ctx.client.createAgent({ provider: "claude", cwd, modeId: "default" });
    await ctx.client.sendMessage(
      agent.id,
      "You must call the Bash command tool with the exact command `rm -f permission.txt`. After approval, run it and reply DONE.",
    );
    const state = await ctx.client.waitForFinish(agent.id, 5000);
    expect(state.status).toBe("permission");
    return { id: agent.id, permissionId: state.final!.pendingPermissions[0].id };
  }

  function collectQueueUpdates(
    client: DaemonClient,
    agentId: string,
  ): { snapshots: AgentQueueSnapshot[]; unsub: () => void } {
    const snapshots: AgentQueueSnapshot[] = [];
    const unsub = client.on("agent.queue.update", (message) => {
      if (message.type === "agent.queue.update" && message.payload.agentId === agentId) {
        snapshots.push(message.payload);
      }
    });
    return { snapshots, unsub };
  }

  test("a message queued on one device is broadcast to another", async () => {
    const agent = await createBusyAgent();
    const { snapshots, unsub } = collectQueueUpdates(secondDevice, agent.id);

    try {
      await ctx.client.enqueueAgentMessage({
        agentId: agent.id,
        itemId: "item-1",
        text: "queued from the first device",
      });

      const mirrored = await waitFor(
        () => findSnapshotWith(snapshots, "item-1"),
        "the queued message to reach the second device",
      );
      expect(mirrored.items[0]?.text).toBe("queued from the first device");

      // The second device reads the same queue on demand, not only via the push.
      const listed = await secondDevice.listQueuedAgentMessages(agent.id);
      expect(listed.items.map((item) => item.id)).toEqual(["item-1"]);
    } finally {
      unsub();
    }
  }, 30000);

  test("cancelling on the second device clears it on the first", async () => {
    const agent = await createBusyAgent();
    const { snapshots, unsub } = collectQueueUpdates(ctx.client, agent.id);

    try {
      await ctx.client.enqueueAgentMessage({ agentId: agent.id, itemId: "item-1", text: "first" });
      await ctx.client.enqueueAgentMessage({ agentId: agent.id, itemId: "item-2", text: "second" });

      await secondDevice.removeQueuedAgentMessage(agent.id, "item-1");

      const cleared = await waitFor(
        () => findLastSnapshotWithout(snapshots, "item-1"),
        "the cancellation to reach the first device",
      );
      expect(cleared.items.map((item) => item.id)).toEqual(["item-2"]);
    } finally {
      unsub();
    }
  }, 30000);

  test("the daemon sends the queued message once the agent frees up", async () => {
    const agent = await createBusyAgent();

    await ctx.client.enqueueAgentMessage({
      agentId: agent.id,
      itemId: "item-1",
      text: "sent by the daemon",
    });
    expect((await ctx.client.listQueuedAgentMessages(agent.id)).items).toHaveLength(1);

    await ctx.client.respondToPermission(agent.id, agent.permissionId, { behavior: "allow" });

    const drained = await waitFor(async () => {
      const queue = await ctx.client.listQueuedAgentMessages(agent.id);
      return queue.items.length === 0 ? queue : undefined;
    }, "the daemon to drain the queue");
    expect(drained.items).toEqual([]);
  }, 30000);

  test("image bytes stay on the daemon and are fetched on demand", async () => {
    const agent = await createBusyAgent();

    const snapshot = await ctx.client.enqueueAgentMessage({
      agentId: agent.id,
      itemId: "item-1",
      text: "look at this",
      images: [{ data: "QUFBQQ==", mimeType: "image/png" }],
    });

    // The snapshot carries a descriptor, never the bytes.
    expect(JSON.stringify(snapshot)).not.toContain("QUFBQQ==");
    expect(snapshot.items[0]?.images?.[0]?.mimeType).toBe("image/png");

    // A device that did not queue the image can still get it back.
    const images = await secondDevice.getQueuedAgentMessageImages(agent.id, "item-1");
    expect(images.map((image) => image.data)).toEqual(["QUFBQQ=="]);
  }, 30000);

  test("the queue survives a client disconnecting", async () => {
    const agent = await createBusyAgent();
    await ctx.client.enqueueAgentMessage({
      agentId: agent.id,
      itemId: "item-1",
      text: "the phone went to sleep",
    });

    await secondDevice.close();

    const queue = await ctx.client.listQueuedAgentMessages(agent.id);
    expect(queue.items.map((item) => item.text)).toEqual(["the phone went to sleep"]);
  }, 30000);
});

function hasItem(snapshot: AgentQueueSnapshot, itemId: string): boolean {
  return snapshot.items.some((item) => item.id === itemId);
}

function findSnapshotWith(
  snapshots: AgentQueueSnapshot[],
  itemId: string,
): AgentQueueSnapshot | undefined {
  return snapshots.find((snapshot) => hasItem(snapshot, itemId));
}

function findLastSnapshotWithout(
  snapshots: AgentQueueSnapshot[],
  itemId: string,
): AgentQueueSnapshot | undefined {
  return snapshots.findLast((snapshot) => !hasItem(snapshot, itemId));
}

async function waitFor<T>(
  read: () => T | undefined | Promise<T | undefined>,
  description: string,
): Promise<T> {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${description}`);
}
