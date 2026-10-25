import path from "node:path";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { writeJsonFileAtomic } from "../atomic-file.js";
import {
  CloudflareWorkerHost,
  LocalListenerHost,
  type SharingPublisherConfig,
  type ShareHost,
} from "./share-host.js";
import { randomBytes } from "node:crypto";
import {
  DEFAULT_REDACTION,
  type RedactionProfile,
  type ShareRecordPayload,
  type ShareSnapshot,
} from "@getpaseo/protocol/sharing";
import type { AgentTimelineStore } from "../agent/agent-timeline-store-types.js";
import { redactTimeline, type SnapshotMetadata } from "./redaction.js";
import { prepareShareSnapshot, renderShareArtifacts, type ShareBytes } from "./render.js";
import { ShareStore, hashToken, sharePayload, type ShareRecord } from "./share-store.js";

export class SharingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export interface ShareSource extends SnapshotMetadata {
  agentId: string;
  workspaceId?: string;
}
const QueueEntrySchema = z.object({
  id: z.string(),
  tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
  baseUrl: z.string(),
  attempts: z.number().int().nonnegative(),
  nextAt: z.number(),
  deleteAfter: z.boolean().optional(),
});
type QueueEntry = z.infer<typeof QueueEntrySchema>;
const RETRY_DELAYS = [60_000, 300_000, 1_800_000, 3_600_000];
export class ShareService {
  private queue: QueueEntry[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private pending: Promise<unknown> = Promise.resolve();
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation);
    this.pending = result.catch(() => undefined);
    return result;
  }
  private queueFile(): string {
    return path.join(this.sharesDir, "unpublish-queue.json");
  }
  private saveQueue(): Promise<void> {
    return writeJsonFileAtomic(this.queueFile(), this.queue);
  }
  async start(): Promise<void> {
    try {
      this.queue = z
        .array(QueueEntrySchema)
        .parse(JSON.parse(await readFile(this.queueFile(), "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    // Recover a crash between the local revocation and enqueueing the host deletion.
    for (const record of await this.store.list()) {
      if (
        record.publishState &&
        record.published &&
        !this.queue.some((entry) => entry.id === record.id)
      )
        this.queue.push({
          id: record.id,
          tokenHash: record.tokenHash,
          baseUrl: record.published.baseUrl,
          attempts: 0,
          nextAt: Date.now(),
        });
    }
    if (this.queue.length) await this.saveQueue();
    this.schedule();
  }
  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.pending;
  }
  private schedule(): void {
    clearTimeout(this.timer);
    if (this.stopped || !this.queue.length) return;
    const delay = Math.max(0, Math.min(...this.queue.map((entry) => entry.nextAt)) - Date.now());
    this.timer = setTimeout(() => {
      void this.retryUnpublishes().catch(() => {
        // A disk failure retains the durable job; avoid a hot loop until storage recovers.
        if (!this.stopped) {
          this.timer = setTimeout(() => this.schedule(), 60_000);
          this.timer.unref();
        }
      });
    }, delay);
    this.timer.unref();
  }
  /** Also used by the fake-host harness to advance the durable queue without waiting a minute. */
  retryUnpublishes(now = Date.now()): Promise<void> {
    return this.serial(async () => {
      for (const entry of this.queue) if (entry.nextAt <= now) await this.unpublish(entry);
      this.schedule();
    });
  }
  private async unpublish(entry: QueueEntry): Promise<void> {
    try {
      if (!this.publisher || this.publisher.baseUrl !== entry.baseUrl)
        throw new Error("Restore the original publisher configuration to finish revocation.");
      await this.host.unpublish(entry.tokenHash);
    } catch {
      entry.nextAt =
        Date.now() + RETRY_DELAYS[Math.min(entry.attempts++, RETRY_DELAYS.length - 1)]!;
      await this.saveQueue();
      return;
    }
    const record = (await this.store.list()).find((value) => value.id === entry.id);
    if (entry.deleteAfter) {
      await this.store.delete(entry.id);
      this.publish(null, entry.id);
    } else if (record) {
      const updated = await this.store.update(
        entry.id,
        ({ publishState: _state, ...current }) => current,
      );
      this.publish(sharePayload(updated));
    }
    this.queue = this.queue.filter((value) => value.id !== entry.id);
    await this.saveQueue();
  }
  private async publishArtifacts(record: ShareRecord, bytes: ShareBytes): Promise<void> {
    if (record.published && record.published.baseUrl !== this.publisher?.baseUrl)
      throw new SharingError(
        "share_publish_failed",
        "Restore this share's original publisher configuration before updating it.",
      );
    try {
      await this.host.publish({
        tokenHash: record.tokenHash,
        expiresAt: record.expiresAt,
        ...bytes,
      });
    } catch (error) {
      throw new SharingError(
        "share_publish_failed",
        error instanceof Error ? error.message : "Share publication failed.",
      );
    }
  }
  private readonly host: ShareHost;

  readonly store: ShareStore;
  private readonly listeners = new Set<
    (share: ShareRecordPayload | null, deletedId?: string) => void
  >();
  constructor(
    private readonly timeline: Pick<AgentTimelineStore, "getCommittedRows">,
    private readonly sharesDir: string,
    private readonly publisher?: SharingPublisherConfig,
  ) {
    this.store = new ShareStore(sharesDir);
    this.host = publisher ? new CloudflareWorkerHost(publisher) : new LocalListenerHost();
  }
  subscribe(listener: (share: ShareRecordPayload | null, deletedId?: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private publish(share: ShareRecordPayload | null, deletedId?: string): void {
    for (const listener of this.listeners) listener(share, deletedId);
  }
  async preview(
    source: ShareSource,
    redaction: RedactionProfile = DEFAULT_REDACTION,
  ): Promise<ShareSnapshot> {
    const snapshot = redactTimeline(
      await this.timeline.getCommittedRows(source.agentId),
      source,
      redaction,
    );
    return prepareShareSnapshot(snapshot).snapshot;
  }
  async create(
    source: ShareSource,
    options: {
      previewDigest?: string;
      publicBaseUrl: string | null;
      configured: boolean;
      redaction?: RedactionProfile;
      expiresAt?: string | null;
    },
  ): Promise<{ share: ShareRecordPayload; url: string }> {
    return this.serial(async () => {
      const baseUrl = this.publisher?.baseUrl ?? options.publicBaseUrl;
      if (!this.publisher && (!options.configured || !baseUrl))
        throw new SharingError(
          "sharing_not_configured",
          "Configure daemon.sharing.publisher or daemon.sharing.listen and daemon.sharing.publicBaseUrl to share conversations.",
        );
      const origin = new URL(baseUrl!);
      if (
        !["http:", "https:"].includes(origin.protocol) ||
        origin.username ||
        origin.password ||
        origin.search ||
        origin.hash
      )
        throw new SharingError(
          "invalid_share_origin",
          "Sharing requires an HTTP(S) public base URL without credentials, query or fragment.",
        );
      const expiresAt =
        options.expiresAt === undefined
          ? new Date(Date.now() + 7 * 86400000).toISOString()
          : options.expiresAt;
      validateExpiry(expiresAt);
      const rows = await this.timeline.getCommittedRows(source.agentId);
      const redaction = options.redaction ?? DEFAULT_REDACTION;
      const prepared = prepareShareSnapshot(redactTimeline(rows, source, redaction));
      const snapshot = prepared.snapshot;
      if (options.previewDigest && options.previewDigest !== snapshot.sourceDigest)
        throw new SharingError(
          "sharing_preview_changed",
          "The conversation changed. Review the refreshed preview before creating a link.",
        );
      const token = randomBytes(32).toString("base64url");
      const record: ShareRecord = {
        id: `shr_${randomBytes(8).toString("hex")}`,
        agentId: source.agentId,
        ...(source.workspaceId ? { workspaceId: source.workspaceId } : {}),
        tokenHash: hashToken(token),
        mode: "snapshot" as const,
        ...(this.publisher
          ? {
              published: {
                kind: this.publisher.kind,
                baseUrl: this.publisher.baseUrl,
                at: new Date().toISOString(),
              },
            }
          : {}),
        title: snapshot.title,
        redaction,
        createdAt: source.createdAt,
        expiresAt,
        revokedAt: null,
        snapshotSeqEnd: rows.reduce((max, row) => Math.max(max, row.seq), 0),
        viewCount: 0,
        lastViewedAt: null,
      };
      await this.publishArtifacts(record, prepared);
      try {
        await this.store.create(record, prepared);
      } catch (error) {
        // If local persistence fails after publishing, retain a durable cleanup job.
        if (record.published) {
          this.queue.push({
            id: record.id,
            tokenHash: record.tokenHash,
            baseUrl: record.published.baseUrl,
            attempts: 0,
            nextAt: Date.now(),
          });
          await this.saveQueue();
          this.schedule();
        }
        throw error;
      }
      const share = sharePayload(record);
      this.publish(share);
      return { share, url: `${baseUrl!.replace(/\/$/, "")}/s/${token}` };
    });
  }
  async list(agentId?: string): Promise<ShareRecordPayload[]> {
    return (await this.store.list(agentId)).map(sharePayload);
  }
  async update(
    id: string,
    patch: { title?: string; expiresAt?: string | null; redaction?: RedactionProfile },
  ): Promise<ShareRecordPayload> {
    if (patch.redaction !== undefined)
      throw new SharingError(
        "snapshot_immutable",
        "Create a new link to change snapshot redaction.",
      );
    if (patch.expiresAt !== undefined) validateExpiry(patch.expiresAt);
    return this.serial(async () => {
      const current = (await this.store.list()).find((record) => record.id === id);
      if (!current) throw new Error("Share not found");
      if (current.revokedAt)
        throw new SharingError("share_revoked", "A revoked share cannot be updated.");
      const title =
        patch.title === undefined
          ? current.title
          : redactTimeline(
              [],
              { title: patch.title, ownerName: "", provider: "", createdAt: current.createdAt },
              current.redaction,
            ).title;
      const next = {
        ...current,
        title,
        ...(patch.expiresAt !== undefined ? { expiresAt: patch.expiresAt } : {}),
      };
      const prepared = renderShareArtifacts({ ...(await this.store.snapshot(id)), title });
      if (current.published) {
        await this.publishArtifacts(next, prepared);
        next.published = { ...current.published, at: new Date().toISOString() };
      }
      const record = await this.store.update(id, (latest) => ({
        ...latest,
        title: next.title,
        expiresAt: next.expiresAt,
        ...(next.published ? { published: next.published } : {}),
      }));
      const share = sharePayload(record);
      this.publish(share);
      return share;
    });
  }
  private async revokeLocal(id: string): Promise<ShareRecord> {
    const record = await this.store.update(id, (current) => ({
      ...current,
      revokedAt: current.revokedAt ?? new Date().toISOString(),
      ...(current.published ? { publishState: "unpublish_pending" as const } : {}),
    }));
    this.publish(sharePayload(record));
    if (record.published && !this.queue.some((entry) => entry.id === id)) {
      this.queue.push({
        id,
        tokenHash: record.tokenHash,
        baseUrl: record.published.baseUrl,
        attempts: 0,
        nextAt: Date.now(),
      });
      await this.saveQueue();
    }
    return record;
  }
  async revoke(id: string): Promise<ShareRecordPayload> {
    return this.serial(async () => {
      const revoked = await this.revokeLocal(id);
      const entry = this.queue.find((value) => value.id === id);
      if (entry) await this.unpublish(entry);
      this.schedule();
      const current = (await this.store.list()).find((record) => record.id === id);
      if (current) return sharePayload(current);
      // A retry of an earlier delete can finish during this explicit revoke.
      const { publishState: _state, ...deleted } = revoked;
      return sharePayload(deleted);
    });
  }
  async delete(id: string): Promise<void> {
    return this.serial(async () => {
      await this.revokeLocal(id);
      const entry = this.queue.find((value) => value.id === id);
      if (entry) {
        // Retain a revoked pending record until the host confirms deletion. Persist
        // deletion intent before removing local artifacts so restart can finish it.
        entry.deleteAfter = true;
        await this.saveQueue();
        await this.store.deleteArtifacts(id);
        await this.unpublish(entry);
      } else {
        await this.store.delete(id);
        this.publish(null, id);
      }
      this.schedule();
    });
  }
}
function validateExpiry(value: string | null): void {
  if (value !== null && !Number.isFinite(Date.parse(value)))
    throw new SharingError("invalid_share_expiry", "Invalid share expiry.");
}

export interface SharingSessionOptions {
  service: ShareService;
  config?: {
    listen: string | null;
    publicBaseUrl: string | null;
    ownerDisplayName: string;
    publisher?: SharingPublisherConfig;
  };
  /** False when the configured share listener failed to bind; create must refuse. */
  isListening?: () => boolean;
}
