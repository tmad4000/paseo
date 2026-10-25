import { createHash, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  ShareRecordPayloadSchema,
  ShareSnapshotSchema,
  type ShareRecordPayload,
} from "@getpaseo/protocol/sharing";
import { writeFileAtomic, writeJsonFileAtomic } from "../atomic-file.js";

import { renderShareArtifacts, type PreparedShareSnapshot, type ShareBytes } from "./render.js";

export const ShareRecordSchema = ShareRecordPayloadSchema.extend({
  tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type ShareRecord = z.infer<typeof ShareRecordSchema>;
export function sharePayload(record: ShareRecord): ShareRecordPayload {
  const { tokenHash: _tokenHash, ...payload } = record;
  return payload;
}
export const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");
export const shareIsActive = (record: ShareRecordPayload, now = Date.now()): boolean =>
  record.revokedAt === null && (record.expiresAt === null || Date.parse(record.expiresAt) > now);

/** All guest access is confined to this store. It has no timeline or daemon capability. */
export class ShareStore {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly sharesDir: string) {}
  private file(id: string, kind: "record" | "json" | "html" = "record"): string {
    if (!/^shr_[a-f0-9]{16}$/.test(id)) throw new Error("Invalid share id");
    return path.join(this.sharesDir, `${id}${kind === "record" ? ".json" : `.snapshot.${kind}`}`);
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation);
    this.pending = result.catch(() => undefined);
    return result;
  }
  private async read(id: string): Promise<ShareRecord | null> {
    try {
      return ShareRecordSchema.parse(JSON.parse(await fs.readFile(this.file(id), "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  private async readAll(): Promise<ShareRecord[]> {
    let names: string[];
    try {
      names = await fs.readdir(this.sharesDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const records: ShareRecord[] = [];
    for (const name of names) {
      if (!/^shr_[a-f0-9]{16}\.json$/.test(name)) continue;
      const record = await this.read(name.slice(0, -5));
      if (record) records.push(record);
    }
    return records;
  }
  snapshot(id: string): Promise<z.infer<typeof ShareSnapshotSchema>> {
    return this.serial(async () =>
      ShareSnapshotSchema.parse(JSON.parse(await fs.readFile(this.file(id, "json"), "utf8"))),
    );
  }
  artifacts(id: string): Promise<ShareBytes> {
    return this.serial(async () => ({
      html: await fs.readFile(this.file(id, "html")),
      json: await fs.readFile(this.file(id, "json")),
    }));
  }
  list(agentId?: string): Promise<ShareRecord[]> {
    return this.serial(async () =>
      (await this.readAll()).filter((r) => !agentId || r.agentId === agentId),
    );
  }
  create(record: ShareRecord, prepared: PreparedShareSnapshot): Promise<void> {
    return this.serial(async () => {
      const value = ShareRecordSchema.parse(record);
      if (await this.read(value.id)) throw new Error("Share already exists");
      // Validate snapshot JSON on owner writes, never on a guest read.
      ShareSnapshotSchema.parse(JSON.parse(prepared.json.toString("utf8")));
      // Publish the capability only after its complete snapshot is durable.
      await writeFileAtomic(this.file(value.id, "html"), prepared.html);
      await writeFileAtomic(this.file(value.id, "json"), prepared.json);
      await writeJsonFileAtomic(this.file(value.id), value);
    });
  }
  update(id: string, change: (record: ShareRecord) => ShareRecord): Promise<ShareRecord> {
    return this.serial(async () => {
      const record = await this.read(id);
      if (!record) throw new Error("Share not found");
      const next = ShareRecordSchema.parse(change(record));
      if (next.title !== record.title) {
        const snapshot = ShareSnapshotSchema.parse(
          JSON.parse(await fs.readFile(this.file(id, "json"), "utf8")),
        );
        const prepared = renderShareArtifacts({ ...snapshot, title: next.title });
        await writeFileAtomic(this.file(id, "html"), prepared.html);
        await writeFileAtomic(this.file(id, "json"), prepared.json);
      }
      await writeJsonFileAtomic(this.file(id), next);
      return next;
    });
  }
  delete(id: string): Promise<void> {
    return this.serial(async () => {
      // Remove authority first; a leftover snapshot can never be served.
      await fs.rm(this.file(id), { force: true });
      await fs.rm(this.file(id, "json"), { force: true });
      await fs.rm(this.file(id, "html"), { force: true });
    });
  }
  view(token: string): Promise<ShareBytes | null> {
    return this.serial(async () => {
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
      const digest = Buffer.from(hashToken(token), "hex");
      const record = (await this.readAll()).find((r) =>
        timingSafeEqual(digest, Buffer.from(r.tokenHash, "hex")),
      );
      if (!record || !shareIsActive(record)) return null;
      const html = await fs.readFile(this.file(record.id, "html"));
      const json = await fs.readFile(this.file(record.id, "json"));
      // View accounting must not prevent reading an otherwise valid immutable snapshot.
      await writeJsonFileAtomic(this.file(record.id), {
        ...record,
        viewCount: record.viewCount + 1,
        lastViewedAt: new Date().toISOString(),
      }).catch(() => undefined);
      return { html, json };
    });
  }
}
