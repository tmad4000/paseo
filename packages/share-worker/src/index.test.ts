import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { type Server } from "node:http";
import type { AddressInfo } from "node:net";
import worker, { GUEST_HEADERS, type Env } from "./index.js";
import { SHARE_CSP, unavailablePage } from "../../server/src/server/sharing/view/page.js";
import { createShareListener } from "../../server/src/server/sharing/share-listener.js";

const token = "x".repeat(43);
const hash = createHash("sha256").update(token).digest("hex");
type Options = Parameters<Env["SHARES"]["put"]>[2];
let entries: Map<string, { value: string; metadata: Options["metadata"] }>;
let env: Env;
const request = (pathname: string, init?: RequestInit) =>
  worker.fetch(new Request(`https://shares.example${pathname}`, init), env);
const put = (body: unknown, suffix = hash) =>
  request(`/admin/shares/${suffix}`, {
    method: "PUT",
    headers: { Authorization: "Bearer fixture-admin" },
    body: JSON.stringify(body),
  });
const body = { html: "<h1>Snapshot</h1>", json: '{"messages":[]}', expiresAt: null };
beforeEach(() => {
  entries = new Map();
  const rate = () => ({ limit: vi.fn(async () => ({ success: true })) });
  env = {
    ADMIN_TOKEN: "fixture-admin",
    GUEST_LIMIT: rate(),
    UNKNOWN_LIMIT: rate(),
    ADMIN_LIMIT: rate(),
    SHARES: {
      getWithMetadata: vi.fn(async (key) => entries.get(key) ?? { value: null, metadata: null }),
      put: vi.fn(async (key, value, options) => {
        entries.set(key, { value, metadata: options.metadata });
      }),
      delete: vi.fn(async (key) => {
        entries.delete(key);
      }),
    },
  };
});
describe("snapshot Worker", () => {
  it("stores and hashes capabilities, serves identical bytes and guest headers, and deletes both keys", async () => {
    expect((await put(body)).status).toBe(204);
    expect([...entries.keys()]).toEqual([`h:${hash}`, `j:${hash}`]);
    for (const [suffix, text, type] of [
      ["", body.html, "text/html"],
      [".json", body.json, "application/json"],
    ]) {
      const response = await request(`/s/${token}${suffix}`);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(text);
      for (const [key, value] of Object.entries(GUEST_HEADERS))
        expect(response.headers.get(key)).toBe(value);
      expect(response.headers.get("Content-Security-Policy")).toBe(SHARE_CSP);
      expect(response.headers.get("Content-Type")).toBe(`${type}; charset=utf-8`);
      expect(response.headers.has("Set-Cookie")).toBe(false);
    }
    expect(JSON.stringify([...entries])).not.toContain(token);
    expect(
      (
        await request(`/admin/shares/${hash}`, {
          method: "DELETE",
          headers: { Authorization: "Bearer fixture-admin" },
        })
      ).status,
    ).toBe(204);
    expect(entries.size).toBe(0);
  });
  it("keeps unavailable bodies and headers byte-identical for unknown, expired, malformed, method and unauthorized routes", async () => {
    await put({ ...body, expiresAt: "2000-01-01T00:00:00Z" });
    const reference = await request("/unknown");
    const headers = [...reference.headers];
    expect(await reference.text()).toBe(unavailablePage());
    for (const [route, init] of [
      [`/s/${token}`, undefined],
      [`/s/${token}.json`, undefined],
      [`/s/${"a".repeat(43)}`, undefined],
      ["/s/malformed", undefined],
      ["/", undefined],
      ["/admin/anything", undefined],
      [`/admin/shares/${hash}`, { method: "PUT", headers: { Authorization: "Bearer wrong" } }],
      [`/s/${token}`, { method: "POST" }],
      [
        `/admin/shares/${hash}`,
        { method: "GET", headers: { Authorization: "Bearer fixture-admin" } },
      ],
    ] as const) {
      const response = await request(route, init);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe(unavailablePage());
      expect([...response.headers]).toEqual(headers);
    }
  });
  it("matches the local listener's unavailable HTML bytes and security/content headers", async () => {
    const server: Server = createShareListener({ view: async () => null });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const local = await fetch(
        `http://127.0.0.1:${(server.address() as AddressInfo).port}/unknown`,
      );
      const hosted = await request("/unknown");
      expect(await hosted.text()).toBe(await local.text());
      for (const key of [...Object.keys(GUEST_HEADERS), "Content-Type"])
        expect(hosted.headers.get(key)).toBe(local.headers.get(key));
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it.each([
    undefined,
    {},
    [],
    { ...body, html: 1 },
    { ...body, json: "not JSON" },
    { ...body, expiresAt: "yesterday" },
    { ...body, expiresAt: "2026-02-31T00:00:00Z" },
    { ...body, expiresAt: "2026-01-01" },
    { ...body, html: "x".repeat(3 * 1024 * 1024) },
    { ...body, json: "x".repeat(3 * 1024 * 1024) },
    { ...body, html: "🦉".repeat(600_000) },
  ])("rejects invalid admin bodies without writes (%#)", async (value) => {
    expect((await put(value)).status).toBe(400);
    expect(entries.size).toBe(0);
  });
  it("requires exact Bearer authentication and hash format, with no admin oracle", async () => {
    for (const auth of [
      "",
      "fixture-admin",
      "bearer fixture-admin",
      "Bearer fixture-admin ",
      "Bearer wrong",
    ]) {
      // Headers normalizes trailing whitespace, so use an internal space for that case.
      const response = await request(`/admin/shares/${hash}`, {
        method: "PUT",
        headers: {
          Authorization: auth === "Bearer fixture-admin " ? "Bearer  fixture-admin" : auth,
        },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(404);
    }
    env.ADMIN_TOKEN = "";
    expect((await put(body)).status).toBe(404);
    env.ADMIN_TOKEN = "fixture-admin";
    expect((await put(body, "wrong-hash")).status).toBe(404);
    expect(entries.size).toBe(0);
  });
  it("derives TTL from ISO expiry, clamps at 60 seconds, and omits it for no expiry", async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      for (const [expiresAt, ttl] of [
        [null, undefined],
        [new Date(now + 90_100).toISOString(), 91],
        [new Date(now + 1000).toISOString(), 60],
        [new Date(now - 1000).toISOString(), 60],
      ] as const) {
        expect((await put({ ...body, expiresAt })).status).toBe(204);
        const options = vi.mocked(env.SHARES.put).mock.lastCall![2];
        expect(options.expirationTtl).toBe(ttl);
        expect(options.metadata).toMatchObject({ expiresAt, createdAt: expect.any(String) });
      }
    } finally {
      clock.mockRestore();
    }
  });
  it("does not acknowledge partial KV publication and removes both artifacts", async () => {
    vi.mocked(env.SHARES.put).mockImplementation(async (key, value, options) => {
      if (key.startsWith("j:")) throw new Error("KV failure");
      entries.set(key, { value, metadata: options.metadata });
    });
    expect((await put(body)).status).toBe(503);
    expect(entries.size).toBe(0);
  });
  it("uses separate IP bindings for guests, unknown tokens and admins", async () => {
    await put(body);
    await request(`/s/${token}`, { headers: { "cf-connecting-ip": "192.0.2.4" } });
    expect(env.GUEST_LIMIT.limit).toHaveBeenLastCalledWith({ key: "192.0.2.4" });
    expect(env.UNKNOWN_LIMIT.limit).not.toHaveBeenCalled();
    await request("/unknown");
    expect(env.UNKNOWN_LIMIT.limit).toHaveBeenLastCalledWith({ key: "unknown" });
    vi.mocked(env.GUEST_LIMIT.limit).mockResolvedValue({ success: false });
    expect((await request(`/s/${token}`)).status).toBe(429);
    vi.mocked(env.ADMIN_LIMIT.limit).mockResolvedValue({ success: false });
    expect((await put(body)).status).toBe(429);
    expect((await request(`/admin/shares/${hash}`)).status).toBe(404);
    vi.mocked(env.GUEST_LIMIT.limit).mockResolvedValue({ success: true });
    vi.mocked(env.UNKNOWN_LIMIT.limit).mockResolvedValue({ success: false });
    expect((await request("/unknown")).status).toBe(429);
  });
});
