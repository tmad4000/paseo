import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ShareService } from "./share-service.js";
import { DEFAULT_REDACTION } from "@getpaseo/protocol/sharing";
import { prepareShareSnapshot, MAX_SHARE_HTML_BYTES } from "./render.js";
import { hashToken } from "./share-store.js";
import type { AgentTimelineRow } from "../agent/agent-timeline-store-types.js";

const source = {
  agentId: "agent",
  title: "Share title",
  provider: "mock",
  ownerName: "Jacob",
  createdAt: "2026-10-24T12:00:00Z",
};
const options = { publicBaseUrl: "https://share.example.com", configured: true };
let directory: string;
let service: ShareService;
let timeline: AgentTimelineRow[];
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "paseo-share-"));
  timeline = [
    { seq: 1, timestamp: source.createdAt, item: { type: "user_message", text: "Hello" } },
  ];
  service = new ShareService({ getCommittedRows: async () => timeline }, directory);
});
afterEach(async () => {
  await service.stop();
  vi.unstubAllGlobals();
  await rm(directory, { recursive: true, force: true });
});
const tokenFrom = (url: string) => url.split("/").at(-1)!;
const viewedSnapshot = async (url: string) => {
  const bytes = await service.store.view(tokenFrom(url));
  return bytes ? JSON.parse(bytes.json.toString("utf8")) : null;
};
describe("share service", () => {
  it("leaves local title and expiry unchanged when a host update fails", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    service = new ShareService({ getCommittedRows: async () => timeline }, directory, {
      kind: "cloudflare-worker",
      baseUrl: "https://shares.example",
      adminToken: "fixture-admin",
    });
    const result = await service.create(source, options);
    const before = await service.store.artifacts(result.share.id);
    fetch.mockResolvedValue(new Response(null, { status: 503 }));
    await expect(
      service.update(result.share.id, { title: "Failed title", expiresAt: null }),
    ).rejects.toMatchObject({ code: "share_publish_failed" });
    expect(await service.store.artifacts(result.share.id)).toEqual(before);
    expect((await service.list())[0]).toEqual(result.share);
  });
  it("retains pending delete records across restarts, removes local artifacts, and honors the backoff", async () => {
    let failing = true;
    const fetch = vi.fn(
      async (_url: string, init: RequestInit) =>
        new Response(null, { status: init.method === "DELETE" && failing ? 503 : 204 }),
    );
    vi.stubGlobal("fetch", fetch);
    const publisher = {
      kind: "cloudflare-worker" as const,
      baseUrl: "https://shares.example",
      adminToken: "fixture-admin",
    };
    service = new ShareService({ getCommittedRows: async () => timeline }, directory, publisher);
    await service.start();
    const result = await service.create(source, { publicBaseUrl: null, configured: false });
    expect(result.url).toMatch(/^https:\/\/shares.example\/s\//);
    await service.delete(result.share.id);
    expect(await service.list()).toMatchObject([
      { id: result.share.id, revokedAt: expect.any(String), publishState: "unpublish_pending" },
    ]);
    expect(await service.store.view(tokenFrom(result.url))).toBeNull();
    await expect(service.store.artifacts(result.share.id)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await service.stop();
    service = new ShareService({ getCommittedRows: async () => timeline }, directory, publisher);
    await service.start();
    const queued = async () =>
      JSON.parse(await readFile(path.join(directory, "unpublish-queue.json"), "utf8"));
    for (const [attempt, delay] of [60_000, 300_000, 1_800_000, 3_600_000, 3_600_000].entries()) {
      const [entry] = await queued();
      expect(entry.attempts).toBe(attempt + 1);
      expect(entry.nextAt - Date.now()).toBeGreaterThan(delay - 1000);
      const before = fetch.mock.calls.length;
      await service.retryUnpublishes(entry.nextAt - 1);
      expect(fetch).toHaveBeenCalledTimes(before);
      if (attempt === 4) {
        failing = false;
        // An explicit revoke can also finish an already queued deletion.
        expect((await service.revoke(result.share.id)).publishState).toBeUndefined();
      } else await service.retryUnpublishes(entry.nextAt);
    }
    expect(await queued()).toEqual([]);
    expect(await service.list()).toEqual([]);
  });
  it("recovers local pending revocation after a crash before enqueue and refuses to republish revoked content", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    const publisher = {
      kind: "cloudflare-worker" as const,
      baseUrl: "https://shares.example",
      adminToken: "fixture-admin",
    };
    service = new ShareService({ getCommittedRows: async () => timeline }, directory, publisher);
    const result = await service.create(source, options);
    await service.store.update(result.share.id, (record) => ({
      ...record,
      revokedAt: new Date().toISOString(),
      publishState: "unpublish_pending",
    }));
    await service.start();
    await service.retryUnpublishes(Date.now() + 1000);
    expect((await service.list())[0]?.publishState).toBeUndefined();
    await expect(service.update(result.share.id, { title: "resurrect" })).rejects.toMatchObject({
      code: "share_revoked",
    });
  });
  it("keeps a pending revocation on its original host after config changes", async () => {
    const fetch = vi.fn(
      async (_url: string, init: RequestInit) =>
        new Response(null, { status: init.method === "DELETE" ? 503 : 204 }),
    );
    vi.stubGlobal("fetch", fetch);
    const publisher = {
      kind: "cloudflare-worker" as const,
      baseUrl: "https://original.example",
      adminToken: "fixture-admin",
    };
    service = new ShareService({ getCommittedRows: async () => timeline }, directory, publisher);
    const result = await service.create(source, options);
    await service.revoke(result.share.id);
    await service.stop();
    fetch.mockClear();
    service = new ShareService({ getCommittedRows: async () => timeline }, directory, {
      ...publisher,
      baseUrl: "https://different.example",
    });
    await service.start();
    await service.retryUnpublishes(Date.now() + 61_000);
    expect(fetch).not.toHaveBeenCalled();
    expect((await service.list())[0]?.publishState).toBe("unpublish_pending");
  });
  it("stores the same bounded 5,000-row preview and publishes both artifacts before the record", async () => {
    timeline = Array.from({ length: 5000 }, (_, i) => ({
      seq: i + 1,
      timestamp: source.createdAt,
      item: { type: "user_message", messageId: `row${i}`, text: `Message ${i}` },
    }));
    const preview = await service.preview(source);
    expect(preview.messages).toHaveLength(501);
    expect(preview.messages[0]).toMatchObject({ kind: "omitted", reason: "earlier", count: 4500 });
    expect(preview.messages[1]).toMatchObject({ text: "Message 4500" });
    const result = await service.create(
      { ...source, createdAt: "2026-10-25T12:00:00Z" },
      { ...options, previewDigest: preview.sourceDigest },
    );
    expect((await viewedSnapshot(result.url)).messages).toEqual(preview.messages);
    const html = await readFile(path.join(directory, `${result.share.id}.snapshot.html`));
    const json = await readFile(path.join(directory, `${result.share.id}.snapshot.json`));
    expect(html.toString()).toContain("4500 earlier messages are not included in this snapshot");
    expect(await service.store.view(tokenFrom(result.url))).toEqual({ html, json });
  });
  it("uses the same rendered-byte bound in preview, create and stored JSON", async () => {
    timeline = [0, 1, 2].map((index) => ({
      seq: index + 1,
      timestamp: source.createdAt,
      item: {
        type: "user_message",
        messageId: `m${index}`,
        text: index === 2 ? "Latest" : "🦉".repeat(300000),
      },
    }));
    const preview = await service.preview(source);
    const result = await service.create(source, {
      ...options,
      previewDigest: preview.sourceDigest,
    });
    const bytes = (await service.store.view(tokenFrom(result.url)))!;
    expect(bytes.html.byteLength).toBeLessThanOrEqual(MAX_SHARE_HTML_BYTES);
    expect(preview.messages).toMatchObject([
      { reason: "earlier", count: 1 },
      { id: "m1" },
      { id: "m2" },
    ]);
    expect(JSON.parse(bytes.json.toString()).messages).toEqual(preview.messages);
  });
  it.each(["html", "json"])(
    "does not publish authority if the %s artifact cannot be written",
    async (extension) => {
      const id = "shr_0123456789abcdef";
      const token = "x".repeat(43);
      await mkdir(path.join(directory, `${id}.snapshot.${extension}`));
      const prepared = prepareShareSnapshot(await service.preview(source));
      await expect(
        service.store.create(
          {
            id,
            agentId: source.agentId,
            tokenHash: hashToken(token),
            mode: "snapshot",
            title: source.title,
            redaction: DEFAULT_REDACTION,
            createdAt: source.createdAt,
            expiresAt: null,
            revokedAt: null,
            viewCount: 0,
            lastViewedAt: null,
          },
          prepared,
        ),
      ).rejects.toThrow();
      expect(await service.list()).toEqual([]);
      expect(await service.store.view(token)).toBeNull();
      await expect(readFile(path.join(directory, `${id}.json`))).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );
  it("rewrites HTML and JSON from the stored snapshot on title update, preserving its messages", async () => {
    const result = await service.create(source, options);
    const before = await viewedSnapshot(result.url);
    timeline.push({
      seq: 2,
      timestamp: source.createdAt,
      item: { type: "user_message", text: "not in the snapshot" },
    });
    await service.update(result.share.id, { title: "A new <title>" });
    const bytes = (await service.store.view(tokenFrom(result.url)))!;
    expect(bytes.html.toString()).toContain("<title>Shared conversation</title>");
    expect(bytes.html.toString()).toContain("<h1>A new &lt;title&gt;</h1>");
    expect(bytes.html.toString()).not.toContain("not in the snapshot");
    expect(JSON.parse(bytes.json.toString())).toMatchObject({
      title: "A new <title>",
      messages: before.messages,
    });
    const original = bytes;
    await expect(
      service.update(result.share.id, { title: "🦉".repeat(MAX_SHARE_HTML_BYTES / 4) }),
    ).rejects.toThrow("size limit");
    expect(await service.store.view(tokenFrom(result.url))).toEqual(original);
  });
  it("does not render JSON-only older snapshots from a guest request", async () => {
    const result = await service.create(source, options);
    await rm(path.join(directory, `${result.share.id}.snapshot.html`));
    await expect(service.store.view(tokenFrom(result.url))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await service.update(result.share.id, { title: "Owner regenerated" });
    expect((await viewedSnapshot(result.url)).title).toBe("Owner regenerated");
  });
  it("records the highest source sequence when projected display order differs", async () => {
    timeline = [
      {
        seq: 4,
        timestamp: source.createdAt,
        item: {
          type: "tool_call",
          callId: "call",
          name: "tool",
          status: "completed",
          error: null,
          detail: { type: "unknown", input: "", output: "" },
        },
      },
      { seq: 3, timestamp: source.createdAt, item: { type: "assistant_message", text: "reply" } },
    ];
    expect((await service.create(source, options)).share.snapshotSeqEnd).toBe(4);
  });
  it("rejects a changed source after preview and scrubs updated titles", async () => {
    const preview = await service.preview(source);
    timeline.push({
      seq: 2,
      timestamp: source.createdAt,
      item: { type: "assistant_message", text: "later" },
    });
    await expect(
      service.create(source, { ...options, previewDigest: preview.sourceDigest }),
    ).rejects.toMatchObject({ code: "sharing_preview_changed" });
    const current = await service.preview(source);
    const result = await service.create(source, {
      ...options,
      previewDigest: current.sourceDigest,
    });
    await service.update(result.share.id, { title: "password=hidden" });
    expect(await viewedSnapshot(result.url)).toMatchObject({
      title: "password=[secret hidden]",
      messages: current.messages,
    });
  });
  it("returns a unique 256-bit token once and stores only its hash", async () => {
    const first = await service.create(source, options);
    const token = tokenFrom(first.url);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await readFile(path.join(directory, `${first.share.id}.json`), "utf8")).not.toContain(
      token,
    );
    expect(JSON.stringify(await service.list())).not.toMatch(/tokenHash|https:/);
    expect(tokenFrom((await service.create(source, options)).url)).not.toBe(token);
    expect(Date.parse(first.share.expiresAt!) - Date.now()).toBeGreaterThan(6.99 * 86400000);
  });
  it("keeps snapshot bytes fixed when source changes", async () => {
    const result = await service.create(source, options);
    const before = await readFile(path.join(directory, `${result.share.id}.snapshot.json`), "utf8");
    timeline.push({
      seq: 2,
      timestamp: source.createdAt,
      item: { type: "assistant_message", text: "later" },
    });
    expect(JSON.stringify(await viewedSnapshot(result.url))).not.toContain("later");
    expect(await readFile(path.join(directory, `${result.share.id}.snapshot.json`), "utf8")).toBe(
      before,
    );
  });
  it("revokes idempotently and deletes the record and both artifacts", async () => {
    const result = await service.create(source, options);
    const revoked = await service.revoke(result.share.id);
    expect(await service.revoke(result.share.id)).toEqual(revoked);
    expect(await service.store.view(tokenFrom(result.url))).toBeNull();
    await service.delete(result.share.id);
    expect(await readdir(directory)).toEqual([]);
  });
  it("enforces expiry and permits no expiry", async () => {
    const expired = await service.create(source, { ...options, expiresAt: "2000-01-01T00:00:00Z" });
    expect(await service.store.view(tokenFrom(expired.url))).toBeNull();
    const never = await service.create(source, { ...options, expiresAt: null });
    expect(await service.store.view(tokenFrom(never.url))).not.toBeNull();
    expect(
      (await service.list()).find((share) => share.id === never.share.id)?.expiresAt,
    ).toBeNull();
  });
  it("previews without writes, rejects unconfigured create and snapshot redaction updates", async () => {
    expect((await service.preview(source)).messages).toHaveLength(1);
    expect(await readdir(directory)).toEqual([]);
    await expect(service.create(source, { ...options, configured: false })).rejects.toMatchObject({
      code: "sharing_not_configured",
    });
    const result = await service.create(source, options);
    await expect(
      service.update(result.share.id, { redaction: result.share.redaction }),
    ).rejects.toMatchObject({ code: "snapshot_immutable" });
    await service.update(result.share.id, { title: "Changed", expiresAt: null });
    expect(await viewedSnapshot(result.url)).toMatchObject({ title: "Changed" });
  });
  it("serializes concurrent views, expiry updates and revoke without restoring access", async () => {
    const result = await service.create(source, options);
    const token = tokenFrom(result.url);
    await Promise.all([
      service.store.view(token),
      service.store.view(token),
      service.revoke(result.share.id),
    ]);
    expect((await service.list())[0]).toMatchObject({ viewCount: 2 });
    expect(await service.store.view(token)).toBeNull();
  });
  it("rejects path traversal and invalid origins/expiry", async () => {
    await expect(service.delete("../config")).rejects.toThrow("Invalid share id");
    await expect(
      service.create(source, { ...options, publicBaseUrl: "javascript:alert(1)" }),
    ).rejects.toThrow();
    await expect(service.create(source, { ...options, expiresAt: "not-a-date" })).rejects.toThrow(
      "Invalid share expiry",
    );
  });
});
