import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

import { AgentAttachmentWireSchema, type AgentQueueSnapshot } from "@getpaseo/protocol/messages";
import { writeJsonFileAtomic } from "../atomic-file.js";

/**
 * Image bytes are held here and never broadcast. See docs/queue-mirroring.md for
 * why a queued image cannot mirror by reference.
 */
const StoredQueuedImageSchema = z.object({
  id: z.string(),
  mimeType: z.string(),
  fileName: z.string().nullable().optional(),
  data: z.string(),
});

const StoredQueuedMessageSchema = z.object({
  id: z.string(),
  text: z.string(),
  attachments: z.array(AgentAttachmentWireSchema).optional(),
  images: z.array(StoredQueuedImageSchema).optional(),
  createdAt: z.string(),
});

const StoredAgentQueueSchema = z.object({
  agentId: z.string(),
  revision: z.number().int().nonnegative(),
  items: z.array(StoredQueuedMessageSchema),
});

export type StoredQueuedImage = z.infer<typeof StoredQueuedImageSchema>;
export type StoredQueuedMessage = z.infer<typeof StoredQueuedMessageSchema>;
export type StoredAgentQueue = z.infer<typeof StoredAgentQueueSchema>;

export function emptyAgentQueue(agentId: string): StoredAgentQueue {
  return { agentId, revision: 0, items: [] };
}

/** Projects the stored queue onto the wire, replacing image bytes with descriptors. */
export function toAgentQueueSnapshot(queue: StoredAgentQueue): AgentQueueSnapshot {
  return {
    agentId: queue.agentId,
    revision: queue.revision,
    items: queue.items.map((item) => ({
      id: item.id,
      text: item.text,
      createdAt: item.createdAt,
      ...(item.attachments?.length ? { attachments: item.attachments } : {}),
      ...(item.images?.length
        ? {
            images: item.images.map((image) => ({
              id: image.id,
              mimeType: image.mimeType,
              fileName: image.fileName ?? null,
              byteSize: approximateBase64ByteSize(image.data),
            })),
          }
        : {}),
    })),
  };
}

function approximateBase64ByteSize(data: string): number {
  let padding = 0;
  if (data.endsWith("==")) {
    padding = 2;
  } else if (data.endsWith("=")) {
    padding = 1;
  }
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

type QueueMutator = (current: StoredAgentQueue) => StoredAgentQueue;

export interface AgentQueueMutationResult {
  queue: StoredAgentQueue;
  changed: boolean;
}

export class AgentQueueStore {
  private readonly mutations = new Map<string, Promise<unknown>>();

  constructor(private readonly dir: string) {}

  async get(agentId: string): Promise<StoredAgentQueue> {
    await this.ensureDir();
    try {
      const content = await readFile(this.filePath(agentId), "utf-8");
      return StoredAgentQueueSchema.parse(JSON.parse(content));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return emptyAgentQueue(agentId);
      }
      throw error;
    }
  }

  /**
   * Read-modify-write under a per-agent lock. A mutator that returns its input
   * unchanged does not bump `revision` and reports `changed: false`, so a no-op
   * never triggers a broadcast.
   *
   * The record survives an empty queue because `revision` has to stay monotonic:
   * deleting the file would restart it at 0 and make clients drop later updates
   * as stale.
   */
  async mutate(agentId: string, mutate: QueueMutator): Promise<AgentQueueMutationResult> {
    return this.serialize(agentId, async () => {
      const current = await this.get(agentId);
      const next = mutate(current);
      if (next === current) {
        return { queue: current, changed: false };
      }
      const updated = StoredAgentQueueSchema.parse({
        ...next,
        agentId,
        revision: current.revision + 1,
      });
      await this.write(updated);
      return { queue: updated, changed: true };
    });
  }

  async delete(agentId: string): Promise<void> {
    await this.serialize(agentId, async () => {
      await this.ensureDir();
      await rm(this.filePath(agentId), { force: true });
    });
  }

  private filePath(agentId: string): string {
    return join(this.dir, `${agentId}.json`);
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  private async write(queue: StoredAgentQueue): Promise<void> {
    await this.ensureDir();
    await writeJsonFileAtomic(this.filePath(queue.agentId), queue);
  }

  private async serialize<T>(agentId: string, mutation: () => Promise<T>): Promise<T> {
    const previous = this.mutations.get(agentId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(mutation);
    this.mutations.set(agentId, next);
    try {
      return await next;
    } finally {
      if (this.mutations.get(agentId) === next) {
        this.mutations.delete(agentId);
      }
    }
  }
}
