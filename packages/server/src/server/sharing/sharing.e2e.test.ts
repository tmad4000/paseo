import { describe, expect, it } from "vitest";
import path from "node:path";
import net, { type AddressInfo } from "node:net";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";

describe("snapshot sharing through the daemon", () => {
  it("creates a redacted share over RPC, broadcasts to two clients, serves and revokes it", async () => {
    const daemon = await createTestPaseoDaemon({
      mcpEnabled: false,
      sharing: {
        listen: "127.0.0.1:0",
        publicBaseUrl: "https://share.example.com",
        ownerDisplayName: "Jacob",
      },
    });
    const clients = [1, 2].map(
      () =>
        new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws`, appVersion: "0.10.0-beta.17" }),
    );
    try {
      for (const client of clients) {
        await client.connect();
        await client.fetchAgents({});
      }
      expect(clients[0]!.getLastServerInfoMessage()?.features?.conversationSharing).toBe(true);
      const received: unknown[][] = [[], []];
      for (const [index, client] of clients.entries()) {
        const subscription = client.observeEvents(["share.link.update"]);
        subscription.subscribe({
          snapshot: () => {},
          update: (message) => received[index]!.push(message),
        });
        await subscription.ready;
      }
      const agent = await daemon.daemon.agentManager.createAgent(
        { provider: "codex", cwd: path.dirname(daemon.paseoHome) },
        undefined,
        { workspaceId: undefined },
      );
      const manager = daemon.daemon.agentManager;
      await manager.appendTimelineItem(agent.id, {
        type: "user_message",
        text: "Explain snapshot sharing",
      });
      await manager.appendTimelineItem(agent.id, {
        type: "tool_call",
        callId: "tool-one",
        name: "shell",
        status: "completed",
        error: null,
        detail: {
          type: "unknown",
          input: "private command",
          output: "sk-1234567890abcdefghijklmnop",
        },
      });
      await manager.appendTimelineItem(agent.id, {
        type: "assistant_message",
        text: "Only this fixed conversation is shared.",
      });
      const preview = await clients[0]!.previewShareLink(agent.id);
      const result = await clients[0]!.createShareLink({
        agentId: agent.id,
        previewDigest: preview.sourceDigest,
      });
      const address = daemon.daemon.getShareAddress() as AddressInfo;
      const guestUrl = `http://127.0.0.1:${address.port}${new URL(result.url).pathname}`;
      const response = await fetch(guestUrl);
      const html = await response.text();
      expect(response.status).toBe(200);
      expect(html).toContain("Explain snapshot sharing");
      expect(html).toContain("Only this fixed conversation is shared.");
      expect(html).toContain("1 tool call hidden");
      expect(html).not.toMatch(/sk-1234567890abcdefghijklmnop|private command/);
      const snapshot = await (await fetch(`${guestUrl}.json`)).json();
      expect(snapshot.messages).toEqual(preview.messages);
      await clients[0]!.revokeShareLink(result.share.id);
      expect((await fetch(guestUrl)).status).toBe(404);
      await expect.poll(() => received[0]!.length).toBe(2);
      await expect.poll(() => received[1]!.length).toBe(2);
      expect(JSON.stringify(received)).not.toMatch(/tokenHash|\/s\//);
      expect(await clients[1]!.listShareLinks(agent.id)).toMatchObject([
        { id: result.share.id, revokedAt: expect.any(String), viewCount: 2 },
      ]);
      await clients[1]!.deleteShareLink(result.share.id);
      expect(await clients[0]!.listShareLinks(agent.id)).toEqual([]);
    } finally {
      for (const client of clients) await client.close();
      await daemon.close();
    }
  }, 60000);
  it("starts without sharing when the share address is busy and reports share_listener_unavailable", async () => {
    const blocker = net.createServer();
    await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
    const busyPort = (blocker.address() as AddressInfo).port;
    const daemon = await createTestPaseoDaemon({
      mcpEnabled: false,
      sharing: {
        listen: `127.0.0.1:${busyPort}`,
        publicBaseUrl: "https://share.example.com",
        ownerDisplayName: "Jacob",
      },
    });
    const client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      appVersion: "0.10.0-beta.17",
    });
    try {
      await client.connect();
      await client.fetchAgents({});
      expect(daemon.daemon.getShareAddress()).toBeNull();
      await expect(client.createShareLink({ agentId: "unused" })).rejects.toMatchObject({
        code: "share_listener_unavailable",
      });
    } finally {
      await client.close();
      await daemon.close();
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  }, 60000);
  it("leaves sharing unbound by default and returns sharing_not_configured", async () => {
    const daemon = await createTestPaseoDaemon({ mcpEnabled: false });
    const client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      appVersion: "0.10.0-beta.17",
    });
    try {
      await client.connect();
      await client.fetchAgents({});
      expect(daemon.daemon.getShareAddress()).toBeNull();
      await expect(client.createShareLink({ agentId: "unused" })).rejects.toMatchObject({
        code: "sharing_not_configured",
      });
    } finally {
      await client.close();
      await daemon.close();
    }
  }, 60000);
});
