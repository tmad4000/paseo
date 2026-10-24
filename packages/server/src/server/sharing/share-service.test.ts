import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ShareService } from "./share-service.js";
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
  await rm(directory, { recursive: true, force: true });
});
const tokenFrom = (url: string) => url.split("/").at(-1)!;
describe("share service", () => {
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
    expect(await service.store.view(tokenFrom(result.url))).toMatchObject({
      title: "[secret hidden]",
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
    expect(JSON.stringify(await service.store.view(tokenFrom(result.url)))).not.toContain("later");
    expect(await readFile(path.join(directory, `${result.share.id}.snapshot.json`), "utf8")).toBe(
      before,
    );
  });
  it("revokes idempotently and deletes both files", async () => {
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
    expect((await service.list())[1]?.expiresAt ?? null).toBeNull();
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
    expect(await service.store.view(tokenFrom(result.url))).toMatchObject({ title: "Changed" });
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
