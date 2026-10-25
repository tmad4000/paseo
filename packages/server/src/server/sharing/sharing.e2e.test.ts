import { describe, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import http from "node:http";
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
      const htmlBytes = Buffer.from(await response.arrayBuffer());
      const html = htmlBytes.toString();
      expect(htmlBytes).toEqual(
        await readFile(path.join(daemon.paseoHome, "shares", `${result.share.id}.snapshot.html`)),
      );
      expect(html).toContain("<title>Shared conversation</title>");
      expect(response.status).toBe(200);
      expect(html).toContain("Explain snapshot sharing");
      expect(html).toContain("Only this fixed conversation is shared.");
      expect(html).toContain("1 tool call hidden");
      expect(html).not.toMatch(/sk-1234567890abcdefghijklmnop|private command/);
      const jsonBytes = Buffer.from(await (await fetch(`${guestUrl}.json`)).arrayBuffer());
      expect(jsonBytes).toEqual(
        await readFile(path.join(daemon.paseoHome, "shares", `${result.share.id}.snapshot.json`)),
      );
      const snapshot = JSON.parse(jsonBytes.toString());
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

describe("external snapshot publishing through the daemon", () => {
  it("prefers publisher URLs while the local listener serves the same artifacts", async () => {
    const artifacts = new Map<string, { html: string; json: string; expiresAt: string | null }>();
    const worker = fakeWorker(
      artifacts,
      () => false,
      () => false,
      () => {},
    );
    await new Promise<void>((resolve) => worker.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${(worker.address() as AddressInfo).port}`;
    const daemon = await createTestPaseoDaemon({
      mcpEnabled: false,
      sharing: {
        listen: "127.0.0.1:0",
        publicBaseUrl: "https://local.example",
        ownerDisplayName: "Jacob",
        publisher: { kind: "cloudflare-worker", baseUrl, adminToken: "fixture-admin" },
      },
    });
    const client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      appVersion: "0.10.0-beta.17",
    });
    try {
      await client.connect();
      await client.fetchAgents({});
      const agent = await daemon.daemon.agentManager.createAgent(
        { provider: "codex", cwd: path.dirname(daemon.paseoHome) },
        undefined,
        { workspaceId: undefined },
      );
      const result = await client.createShareLink({ agentId: agent.id });
      expect(result.url.startsWith(`${baseUrl}/s/`)).toBe(true);
      const address = daemon.daemon.getShareAddress() as AddressInfo;
      const local = await fetch(`http://127.0.0.1:${address.port}${new URL(result.url).pathname}`);
      expect(local.status).toBe(200);
      expect(await local.text()).toBe([...artifacts.values()][0]!.html);
      await client.revokeShareLink(result.share.id);
      expect(artifacts.size).toBe(0);
    } finally {
      await client.close();
      await daemon.close();
      worker.closeAllConnections();
      await new Promise<void>((resolve) => worker.close(() => resolve()));
    }
  });
  it("publishes redacted artifacts without a listener, updates host TTL/title, retries revoke, and fails create without persistence", async () => {
    const artifacts = new Map<string, { html: string; json: string; expiresAt: string | null }>();
    let failPut = false;
    let failDelete = false;
    let deleteRequests = 0;
    const worker = fakeWorker(
      artifacts,
      () => failPut,
      () => failDelete,
      () => {
        deleteRequests++;
      },
    );
    await new Promise<void>((resolve) => worker.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${(worker.address() as AddressInfo).port}`;
    const daemon = await createTestPaseoDaemon({
      mcpEnabled: false,
      sharing: {
        listen: null,
        publicBaseUrl: null,
        ownerDisplayName: "Jacob",
        publisher: { kind: "cloudflare-worker", baseUrl, adminToken: "fixture-admin" },
      },
    });
    const client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      appVersion: "0.10.0-beta.17",
    });
    try {
      await client.connect();
      await client.fetchAgents({});
      const agent = await daemon.daemon.agentManager.createAgent(
        { provider: "codex", cwd: path.dirname(daemon.paseoHome) },
        undefined,
        { workspaceId: undefined },
      );
      await daemon.daemon.agentManager.appendTimelineItem(agent.id, {
        type: "user_message",
        text: "password=fixture-secret-value",
      });
      expect(daemon.daemon.getShareAddress()).toBeNull();
      const result = await client.createShareLink({ agentId: agent.id });
      expect(result.url).toMatch(new RegExp(`^${baseUrl}/s/[A-Za-z0-9_-]{43}$`));
      expect(result.share.published).toMatchObject({
        kind: "cloudflare-worker",
        baseUrl,
        at: expect.any(String),
      });
      const [key, bytes] = [...artifacts][0]!;
      expect(bytes.html).not.toContain("fixture-secret-value");
      expect(bytes.html).toContain("[secret hidden]");
      expect(bytes.html).toBe(
        await readFile(
          path.join(daemon.paseoHome, "shares", `${result.share.id}.snapshot.html`),
          "utf8",
        ),
      );
      expect(bytes.json).toBe(
        await readFile(
          path.join(daemon.paseoHome, "shares", `${result.share.id}.snapshot.json`),
          "utf8",
        ),
      );
      await client.updateShareLink(result.share.id, { title: "New title", expiresAt: null });
      expect(artifacts.get(key)).toMatchObject({
        expiresAt: null,
        html: expect.stringContaining("<h1>New title</h1>"),
      });
      failPut = true;
      await expect(client.createShareLink({ agentId: agent.id })).rejects.toMatchObject({
        code: "share_publish_failed",
        message: expect.stringContaining("base URL and admin token"),
      });
      expect(await client.listShareLinks()).toHaveLength(1);
      expect(
        (await readdir(path.join(daemon.paseoHome, "shares"))).filter((name) =>
          name.startsWith("shr_"),
        ),
      ).toHaveLength(3);
      failPut = false;
      failDelete = true;
      const revoked = await client.revokeShareLink(result.share.id);
      expect(revoked).toMatchObject({
        revokedAt: expect.any(String),
        publishState: "unpublish_pending",
      });
      expect(artifacts.size).toBe(1);
      const queue = JSON.parse(
        await readFile(path.join(daemon.paseoHome, "shares", "unpublish-queue.json"), "utf8"),
      );
      expect(queue).toMatchObject([{ id: result.share.id, tokenHash: key, attempts: 1 }]);
      failDelete = false;
      await expect.poll(() => deleteRequests, { timeout: 75_000, interval: 500 }).toBe(2);
      await expect
        .poll(async () => (await client.listShareLinks())[0]?.publishState)
        .toBeUndefined();
      expect(artifacts.size).toBe(0);
      await client.deleteShareLink(result.share.id);
      expect(await client.listShareLinks()).toEqual([]);
    } finally {
      await client.close();
      await daemon.close();
      worker.closeAllConnections();
      await new Promise<void>((resolve) => worker.close(() => resolve()));
    }
  }, 120_000);
});

function fakeWorker(
  artifacts: Map<string, { html: string; json: string; expiresAt: string | null }>,
  failPut: () => boolean,
  failDelete: () => boolean,
  onDelete: () => void,
): http.Server {
  return http.createServer((request, response) => {
    if (
      request.headers.authorization !== "Bearer fixture-admin" ||
      !/^\/admin\/shares\/[a-f0-9]{64}$/.test(request.url ?? "")
    ) {
      response.writeHead(404).end();
      return;
    }
    const key = request.url!.split("/").at(-1)!;
    if (request.method === "DELETE") {
      onDelete();
      if (failDelete()) response.writeHead(503).end();
      else {
        artifacts.delete(key);
        response.writeHead(204).end();
      }
      return;
    }
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      if (failPut()) {
        response.writeHead(404).end();
        return;
      }
      artifacts.set(key, JSON.parse(body));
      response.writeHead(204).end();
    });
  });
}
