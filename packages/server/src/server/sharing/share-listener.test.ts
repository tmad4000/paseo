import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import type { Application } from "express";
import { ShareRateLimiter, shareRateLimitKey } from "./share-rate-limiter.js";
import type http from "node:http";
import * as renderer from "./render.js";
import type { AgentTimelineRow } from "../agent/agent-timeline-store-types.js";
import { ShareService } from "./share-service.js";
import { createShareListener } from "./share-listener.js";
let dir: string;
let service: ShareService;
let server: http.Server;
let base: string;
let timeline: AgentTimelineRow[];
const source = {
  agentId: "agent",
  title: "Example <script>bad</script>",
  provider: "mock",
  ownerName: "Jacob",
  createdAt: "2026-10-24T12:00:00Z",
};
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "paseo-share-http-"));
  timeline = [
    {
      seq: 1,
      timestamp: source.createdAt,
      item: {
        type: "assistant_message",
        text: "**Hello** <script>alert(1)</script> [bad](javascript:alert(1)) ![image](https://evil.example/image.png) [safe](https://example.com)",
      },
    },
  ];
  service = new ShareService({ getCommittedRows: async () => timeline }, dir);
  await startListener();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await stopListener();
  await service.stop();
  await rm(dir, { recursive: true, force: true });
});
async function startListener(
  reader: Parameters<typeof createShareListener>[0] = {
    view: (token) => service.store.view(token),
  },
  options: Parameters<typeof createShareListener>[1] = {},
): Promise<void> {
  server = createShareListener(reader, options);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
}
async function stopListener(): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
const fixtureBytes = { html: Buffer.from("<p>Snapshot</p>"), json: Buffer.from("{}") };
const create = (expiresAt?: string | null) =>
  service.create(source, { configured: true, publicBaseUrl: base, expiresAt });
describe("share listener", () => {
  it("serves HEAD with GET's status, headers and byte length but no body", async () => {
    const { url } = await create();
    for (const extension of ["", ".json"]) {
      const get = await fetch(`${url}${extension}`);
      const bytes = await get.arrayBuffer();
      const head = await fetch(`${url}${extension}`, { method: "HEAD" });
      expect(head.status).toBe(get.status);
      for (const name of [
        "content-type",
        "content-length",
        "cache-control",
        "referrer-policy",
        "x-robots-tag",
        "content-security-policy",
        "x-content-type-options",
      ])
        expect(head.headers.get(name)).toBe(get.headers.get(name));
      expect(head.headers.get("content-length")).toBe(String(bytes.byteLength));
      expect(await head.text()).toBe("");
    }
  });
  it("disables query parsing and bounds headers and request lifetimes", () => {
    const app = server.listeners("request")[0] as Application;
    expect(app.get("query parser")).toBe(false);
    expect(server).toMatchObject({
      headersTimeout: 15_000,
      requestTimeout: 30_000,
      keepAliveTimeout: 5_000,
      maxHeadersCount: 50,
    });
  });
  it("rejects long raw URLs and unsupported methods with the unavailable page before reading", async () => {
    await stopListener();
    const reads: string[] = [];
    await startListener({
      view: async (token) => {
        reads.push(token);
        return fixtureBytes;
      },
    });
    const unavailable = await fetch(`${base}/not-a-share`);
    const expectedBody = await unavailable.text();
    const route = `/s/${"x".repeat(43)}`;
    for (const method of ["POST", "PUT", "DELETE", "PATCH", "OPTIONS"]) {
      const response = await fetch(`${base}${route}`, { method });
      expect(response.status).toBe(404);
      expect(await response.text()).toBe(expectedBody);
    }
    const long = await fetch(`${base}${route}?${"x".repeat(256 - route.length)}`);
    expect(long.status).toBe(404);
    expect(await long.text()).toBe(expectedBody);
    expect(reads).toEqual([]);
    const boundary = await fetch(`${base}${route}?${"x".repeat(255 - route.length)}`);
    expect(boundary.status).toBe(200);
    expect(reads).toEqual(["x".repeat(43)]);
    const head = await fetch(`${base}/not-a-share`, { method: "HEAD" });
    expect(head.status).toBe(404);
    expect(head.headers.get("content-length")).toBe(String(Buffer.byteLength(expectedBody)));
    expect(await head.text()).toBe("");
  });
  it("charges rejected methods against the peer limit without reading storage", async () => {
    await stopListener();
    const reads: string[] = [];
    await startListener({
      view: async (token) => {
        reads.push(token);
        return fixtureBytes;
      },
    });
    for (let i = 0; i < 60; i++) {
      const response = await fetch(`${base}/s/${"x".repeat(43)}`, { method: "POST" });
      expect(response.status).toBe(404);
      await response.text();
    }
    expect((await fetch(`${base}/s/${"x".repeat(43)}`, { method: "POST" })).status).toBe(429);
    expect(reads).toEqual([]);
  });
  it.each([false, true])(
    "honors forwarded-IP peer budgets only when enabled (%s)",
    async (enabled) => {
      await stopListener();
      let reads = 0;
      await startListener(
        {
          view: async () => {
            reads++;
            return fixtureBytes;
          },
        },
        { trustForwardedFor: enabled },
      );
      const url = `${base}/s/${"x".repeat(43)}`;
      for (let i = 0; i < 60; i++) {
        const response = await fetch(url, { headers: { "X-Forwarded-For": "192.0.2.1" } });
        expect(response.status).toBe(200);
        await response.text();
      }
      const response = await fetch(url, { headers: { "X-Forwarded-For": "192.0.2.2, 192.0.2.1" } });
      expect(response.status).toBe(enabled ? 200 : 429);
      await response.text();
      expect(reads).toBe(enabled ? 61 : 60);
    },
  );
  it("enforces a global ceiling across 600 valid requests under different forwarded keys", async () => {
    await stopListener();
    let reads = 0;
    await startListener(
      {
        view: async () => {
          reads++;
          return fixtureBytes;
        },
      },
      { trustForwardedFor: true },
    );
    const url = `${base}/s/${"x".repeat(43)}`;
    for (let i = 0; i < 600; i++) {
      const response = await fetch(url, {
        headers: { "X-Forwarded-For": `192.0.2.${1 + Math.floor(i / 60)}` },
      });
      expect(response.status).toBe(200);
      await response.text();
    }
    const response = await fetch(url, { headers: { "X-Forwarded-For": "198.51.100.1" } });
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(reads).toBe(600);
  });
  it("loads the listener without a renderer or Markdown dependency", async () => {
    vi.resetModules();
    vi.doMock("./render.js", () => {
      throw new Error("Renderer reached from listener");
    });
    vi.doMock("markdown-it", () => {
      throw new Error("Markdown reached from listener");
    });
    try {
      expect((await import("./share-listener.js")).createShareListener).toBeTypeOf("function");
    } finally {
      vi.doUnmock("./render.js");
      vi.doUnmock("markdown-it");
      vi.resetModules();
    }
  });
  it("serves byte-identical 5,000-row bounded artifacts with no guest rendering", async () => {
    timeline = Array.from({ length: 5000 }, (_, i) => ({
      seq: i + 1,
      timestamp: source.createdAt,
      item: { type: "user_message", messageId: `m${i}`, text: `Message ${i}` },
    }));
    const preview = await service.preview(source);
    const { url, share } = await service.create(source, {
      configured: true,
      publicBaseUrl: base,
      previewDigest: preview.sourceDigest,
    });
    const page = vi.spyOn(renderer, "renderSharePage");
    const prepare = vi.spyOn(renderer, "prepareShareSnapshot");
    const artifacts = vi.spyOn(renderer, "renderShareArtifacts");
    for (const extension of ["html", "json"]) {
      const response = await fetch(`${url}${extension === "json" ? ".json" : ""}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(
        extension === "json" ? "application/json; charset=utf-8" : "text/html; charset=utf-8",
      );
      const bytes = Buffer.from(await response.arrayBuffer());
      expect(bytes).toEqual(await readFile(path.join(dir, `${share.id}.snapshot.${extension}`)));
      expect(response.headers.get("content-length")).toBe(String(bytes.byteLength));
      if (extension === "json") {
        const snapshot = JSON.parse(bytes.toString());
        expect(snapshot.messages).toEqual(preview.messages);
        expect(snapshot.messages).toHaveLength(501);
        expect(snapshot.messages[0]).toMatchObject({
          kind: "omitted",
          reason: "earlier",
          count: 4500,
        });
      } else
        expect(bytes.toString()).toContain(
          "4500 earlier messages are not included in this snapshot",
        );
    }
    expect(page).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(artifacts).not.toHaveBeenCalled();
  });
  it("does not render a missing HTML artifact on a guest GET", async () => {
    const { url, share } = await create();
    await rm(path.join(dir, `${share.id}.snapshot.html`));
    const render = vi.spyOn(renderer, "renderShareArtifacts");
    expect((await fetch(url)).status).toBe(404);
    expect(render).not.toHaveBeenCalled();
  });
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
    expect(html).toContain("<title>Shared conversation</title>");
    expect(html.split("</head>")[0]).not.toContain("Example");
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
  it.each(["TRACE", "CONNECT"])(
    "rejects %s with the same unavailable page before reading",
    async (method) => {
      await stopListener();
      const reads: string[] = [];
      await startListener({
        view: async (token) => {
          reads.push(token);
          return fixtureBytes;
        },
      });
      const reference = await (await fetch(`${base}/unknown`)).text();
      const target = method === "CONNECT" ? "example.com:443" : `/s/${"x".repeat(43)}`;
      const response = await rawRequest(method, target);
      expect(response).toContain("404 Not Found");
      expect(response.split("\r\n\r\n").slice(1).join("\r\n\r\n")).toBe(reference);
      expect(reads).toEqual([]);
    },
  );
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

describe("share request limits", () => {
  it.each([
    [false, "127.0.0.1", "192.0.2.1", "127.0.0.1"],
    [true, "127.0.0.1", "192.0.2.1, 198.51.100.1", "192.0.2.1"],
    [true, "127.255.255.255", "192.0.2.1", "192.0.2.1"],
    [true, "::1", "2001:db8::1", "2001:db8::1"],
    [true, "::ffff:7f00:1", "192.0.2.1", "192.0.2.1"],
    [true, "100.64.0.0", "192.0.2.1", "192.0.2.1"],
    [true, "100.127.255.255", "192.0.2.1", "192.0.2.1"],
    [true, "::ffff:100.84.1.2", "192.0.2.1", "192.0.2.1"],
    [true, "100.63.255.255", "192.0.2.1", "100.63.255.255"],
    [true, "100.128.0.0", "192.0.2.1", "100.128.0.0"],
    [true, "198.51.100.1", "127.0.0.1", "198.51.100.1"],
    [true, "::ffff:198.51.100.1", "127.0.0.1", "::ffff:198.51.100.1"],
    [true, "unknown", "192.0.2.1", "unknown"],
    [true, "127.0.0.1", "invalid, 192.0.2.1", "127.0.0.1"],
    [true, "127.0.0.1", undefined, "127.0.0.1"],
  ] as const)(
    "selects a key only for an opted-in trusted socket peer (%s %s %s)",
    (enabled, peer, forwarded, expected) => {
      expect(shareRateLimitKey(peer, forwarded, enabled)).toBe(expected);
    },
  );
  it("resets global and peer windows at their exact boundaries", () => {
    const limits = new ShareRateLimiter();
    for (let i = 0; i < 600; i++) expect(limits.globalUntil(1_000)).toBeNull();
    expect(limits.globalUntil(60_999)).toBe(61_000);
    expect(limits.globalUntil(61_000)).toBeNull();
    for (let i = 1; i <= 60; i++)
      expect(limits.peerWindow("127.0.0.1", undefined, 1_000).total).toBe(i);
    expect(limits.peerWindow("127.0.0.1", undefined, 60_999).total).toBe(61);
    expect(limits.peerWindow("127.0.0.1", undefined, 61_000).total).toBe(1);
  });
});

function rawRequest(method: string, target: string): Promise<string> {
  const port = (server.address() as net.AddressInfo).port;
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write(`${method} ${target} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);
    });
    const chunks: Buffer[] = [];
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    socket.on("error", reject);
  });
}
