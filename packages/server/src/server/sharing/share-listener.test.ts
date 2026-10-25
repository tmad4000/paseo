import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
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
  server = createShareListener(service.store);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
});
afterEach(async () => {
  vi.restoreAllMocks();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(dir, { recursive: true, force: true });
});
const create = (expiresAt?: string | null) =>
  service.create(source, { configured: true, publicBaseUrl: base, expiresAt });
describe("share listener", () => {
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
