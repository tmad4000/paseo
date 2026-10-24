import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import type http from "node:http";
import { ShareService } from "./share-service.js";
import { createShareListener } from "./share-listener.js";
let dir: string;
let service: ShareService;
let server: http.Server;
let base: string;
const source = {
  agentId: "agent",
  title: "Example <script>bad</script>",
  provider: "mock",
  ownerName: "Jacob",
  createdAt: "2026-10-24T12:00:00Z",
};
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "paseo-share-http-"));
  service = new ShareService(
    {
      getCommittedRows: async () => [
        {
          seq: 1,
          timestamp: source.createdAt,
          item: {
            type: "assistant_message",
            text: "**Hello** <script>alert(1)</script> [bad](javascript:alert(1)) ![image](https://evil.example/image.png) [safe](https://example.com)",
          },
        },
      ],
    },
    dir,
  );
  server = createShareListener(service.store);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(dir, { recursive: true, force: true });
});
const create = (expiresAt?: string | null) =>
  service.create(source, { configured: true, publicBaseUrl: base, expiresAt });
describe("share listener", () => {
  it("enforces the unknown-token limit for concurrent requests without blocking valid links", async () => {
    const { url } = await create();
    const responses = await Promise.all(
      Array.from({ length: 15 }, () => fetch(`${base}/s/${"z".repeat(43)}`)),
    );
    expect(responses.filter((response) => response.status === 404)).toHaveLength(10);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(5);
    expect((await fetch(url)).status).toBe(200);
  });
  it("renders safe Markdown, security headers and JSON without cookies", async () => {
    const { url } = await create();
    const response = await fetch(url);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("<strong>Hello</strong>");
    expect(html).not.toMatch(/<script|<img|href="javascript:/);
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await (await fetch(`${url}.json`)).json()).toMatchObject({ v: 1, title: source.title });
  });
  it("uses identical 404 responses for unavailable shares and every other route", async () => {
    const revoked = await create();
    await service.revoke(revoked.share.id);
    const expired = await create("2000-01-01T00:00:00Z");
    let expectedBody: string | undefined;
    for (const url of [
      `${base}/s/${"a".repeat(43)}`,
      revoked.url,
      expired.url,
      `${base}/s/invalid`,
      `${base}/`,
      `${base}/api/health`,
      `${base}/mcp/agents`,
      `${base}/s/`,
    ]) {
      const response = await fetch(url);
      expect(response.status).toBe(404);
      const body = await response.text();
      expectedBody ??= body;
      expect(body).toBe(expectedBody);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });
  it("limits unknown tokens to ten requests per minute", async () => {
    for (let i = 0; i < 10; i++)
      expect((await fetch(`${base}/s/${"x".repeat(43)}`)).status).toBe(404);
    expect((await fetch(`${base}/s/${"x".repeat(43)}`)).status).toBe(429);
  });
  it("limits valid views to sixty requests per minute", async () => {
    const { url } = await create();
    for (let i = 0; i < 60; i++) expect((await fetch(url)).status).toBe(200);
    expect((await fetch(url)).status).toBe(429);
  });
  it("never accepts a WebSocket upgrade", async () => {
    const port = (server.address() as net.AddressInfo).port;
    const reply = await new Promise<string>((resolve, reject) => {
      const socket = net.connect(port, "127.0.0.1", () =>
        socket.write(
          "GET /s/anything HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
        ),
      );
      let received = "";
      socket.on("data", (data) => {
        received += data.toString();
      });
      socket.on("end", () => resolve(received));
      socket.on("error", reject);
    });
    expect(reply).toContain("404 Not Found");
    expect(reply).not.toContain("101");
  });
});
