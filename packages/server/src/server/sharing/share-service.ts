import { createHash, randomBytes } from "node:crypto";
import {
  DEFAULT_REDACTION,
  type RedactionProfile,
  type ShareRecordPayload,
  type ShareSnapshot,
} from "@getpaseo/protocol/sharing";
import type { AgentTimelineStore } from "../agent/agent-timeline-store-types.js";
import { redactTimeline, type SnapshotMetadata } from "./redaction.js";
import { ShareStore, hashToken, sharePayload } from "./share-store.js";

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
export class ShareService {
  readonly store: ShareStore;
  private readonly listeners = new Set<
    (share: ShareRecordPayload | null, deletedId?: string) => void
  >();
  constructor(
    private readonly timeline: Pick<AgentTimelineStore, "getCommittedRows">,
    sharesDir: string,
  ) {
    this.store = new ShareStore(sharesDir);
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
    return { ...snapshot, sourceDigest: snapshotDigest(snapshot) };
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
    if (!options.configured || !options.publicBaseUrl)
      throw new SharingError(
        "sharing_not_configured",
        "Configure daemon.sharing.listen and daemon.sharing.publicBaseUrl to share conversations.",
      );
    const origin = new URL(options.publicBaseUrl);
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
    const snapshot = redactTimeline(rows, source, redaction);
    snapshot.sourceDigest = snapshotDigest(snapshot);
    if (options.previewDigest && options.previewDigest !== snapshot.sourceDigest)
      throw new SharingError(
        "sharing_preview_changed",
        "The conversation changed. Review the refreshed preview before creating a link.",
      );
    const token = randomBytes(32).toString("base64url");
    const record = {
      id: `shr_${randomBytes(8).toString("hex")}`,
      agentId: source.agentId,
      ...(source.workspaceId ? { workspaceId: source.workspaceId } : {}),
      tokenHash: hashToken(token),
      mode: "snapshot" as const,
      title: snapshot.title,
      redaction,
      createdAt: source.createdAt,
      expiresAt,
      revokedAt: null,
      snapshotSeqEnd: rows.reduce((max, row) => Math.max(max, row.seq), 0),
      viewCount: 0,
      lastViewedAt: null,
    };
    await this.store.create(record, snapshot);
    const share = sharePayload(record);
    this.publish(share);
    return { share, url: `${options.publicBaseUrl.replace(/\/$/, "")}/s/${token}` };
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
    const record = await this.store.update(id, (current) => ({
      ...current,
      ...(patch.title !== undefined
        ? {
            title: redactTimeline(
              [],
              { title: patch.title, ownerName: "", provider: "", createdAt: current.createdAt },
              current.redaction,
            ).title,
          }
        : {}),
      ...(patch.expiresAt !== undefined ? { expiresAt: patch.expiresAt } : {}),
    }));
    const share = sharePayload(record);
    this.publish(share);
    return share;
  }
  async revoke(id: string): Promise<ShareRecordPayload> {
    const share = sharePayload(
      await this.store.update(id, (record) => ({
        ...record,
        revokedAt: record.revokedAt ?? new Date().toISOString(),
      })),
    );
    this.publish(share);
    return share;
  }
  async delete(id: string): Promise<void> {
    await this.store.delete(id);
    this.publish(null, id);
  }
}
function validateExpiry(value: string | null): void {
  if (value !== null && !Number.isFinite(Date.parse(value)))
    throw new SharingError("invalid_share_expiry", "Invalid share expiry.");
}

export interface SharingSessionOptions {
  service: ShareService;
  config?: { listen: string | null; publicBaseUrl: string | null; ownerDisplayName: string };
  /** False when the configured share listener failed to bind; create must refuse. */
  isListening?: () => boolean;
}

function snapshotDigest(snapshot: ShareSnapshot): string {
  const { createdAt: _createdAt, sourceDigest: _digest, ...content } = snapshot;
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}
