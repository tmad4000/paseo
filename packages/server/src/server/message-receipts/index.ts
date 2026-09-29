import { createHash } from "node:crypto";
import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { writeJsonFileAtomic } from "../atomic-file.js";

const ReceiptSchema = z.object({
  fingerprint: z.string(),
  state: z.enum(["pending", "completed", "removed"]),
  agentId: z.string(),
  messageId: z.string().optional(),
  attachmentId: z.string().optional(),
  voiceOwner: z.string().optional(),
  createdAt: z.string().optional(),
});
interface SendMessageInput {
  agentId: string;
  messageId: string;
  request: unknown;
  attachmentId?: string;
  voiceOwner?: string;
  createdAt?: string;
  send: () => Promise<void>;
  prepare?: () => Promise<void>;
}

/** Owns message delivery receipts; creation is owned by CreationService. */
export class MessageReceipts {
  private readonly pending = new Map<string, Promise<void>>();
  constructor(private readonly directory: string) {}

  async listForAttachment(input: {
    agentId: string;
    attachmentId: string;
    voiceOwner?: string;
  }): Promise<
    Array<{
      messageId: string;
      state: "pending" | "sending" | "completed" | "removed";
      createdAt: string;
    }>
  > {
    const files = await readdir(this.directory).catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw error;
    });
    const records = await Promise.all(
      files
        .filter((name) => name.endsWith(".json"))
        .map((name) => readReceipt(path.join(this.directory, name))),
    );
    return records
      .filter((record): record is NonNullable<typeof record> => record !== null)
      .filter(
        (record) =>
          record.agentId === input.agentId &&
          record.attachmentId === input.attachmentId &&
          record.voiceOwner === input.voiceOwner &&
          !!record.messageId,
      )
      .map((record) => ({
        messageId: record.messageId!,
        state:
          record.state === "pending" &&
          this.pending.has(digest(["send", record.agentId, record.messageId]))
            ? ("sending" as const)
            : record.state,
        createdAt: record.createdAt ?? "",
      }));
  }

  async get(
    agentId: string,
    messageId: string,
    request?: unknown,
  ): Promise<"absent" | "pending" | "completed" | "removed"> {
    const key = digest(["send", agentId, messageId]);
    const existing = await readReceipt(path.join(this.directory, `${key}.json`));
    if (existing && request !== undefined && existing.fingerprint !== digest(request)) {
      throw new Error("agent_request_key_conflict");
    }
    return existing?.state ?? "absent";
  }

  async recordRemoved(input: {
    agentId: string;
    messageId: string;
    request: unknown;
    attachmentId?: string;
    voiceOwner?: string;
    createdAt?: string;
  }): Promise<boolean> {
    const key = digest(["send", input.agentId, input.messageId]);
    const previous = this.pending.get(key);
    const result = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(
      async () => {
        const file = path.join(this.directory, `${key}.json`);
        const fingerprint = digest(input.request);
        const existing = await readReceipt(file);
        if (existing) {
          if (existing.fingerprint !== fingerprint) throw new Error("agent_request_key_conflict");
          return existing.state === "removed";
        }
        await writeJsonFileAtomic(file, {
          fingerprint,
          state: "removed",
          agentId: input.agentId,
          messageId: input.messageId,
          ...(input.attachmentId
            ? { attachmentId: input.attachmentId, voiceOwner: input.voiceOwner }
            : {}),
          createdAt: input.createdAt ?? new Date().toISOString(),
        });
        return true;
      },
    );
    const tracked = result.then(() => undefined);
    void tracked.catch(() => undefined);
    this.pending.set(key, tracked);
    try {
      return await result;
    } finally {
      if (this.pending.get(key) === tracked) this.pending.delete(key);
    }
  }

  send(input: SendMessageInput): Promise<void> {
    // Preserve the existing on-disk identity and shape across daemon upgrades.
    const key = digest(["send", input.agentId, input.messageId]);
    const previous = this.pending.get(key);
    const result = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(() =>
      this.sendOnce(key, input),
    );
    this.pending.set(key, result);
    void result
      .finally(() => {
        if (this.pending.get(key) === result) this.pending.delete(key);
      })
      .catch(() => undefined);
    return result;
  }

  private async sendOnce(key: string, input: SendMessageInput): Promise<void> {
    const file = path.join(this.directory, `${key}.json`);
    const fingerprint = digest(input.request);
    const existing = await readReceipt(file);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new Error("agent_request_key_conflict");
      if (existing.state === "completed" || existing.state === "removed") return;
      // A provider may have accepted the message before its receipt was committed.
      throw new Error("agent_request_outcome_unknown");
    }
    await input.prepare?.();
    const receipt = {
      fingerprint,
      agentId: input.agentId,
      messageId: input.messageId,
      ...(input.attachmentId
        ? { attachmentId: input.attachmentId, voiceOwner: input.voiceOwner }
        : {}),
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    await writeJsonFileAtomic(file, { ...receipt, state: "pending" });
    try {
      await input.send();
    } catch (error) {
      // A competing run rejected the synchronous reservation before provider dispatch.
      // This is the only post-receipt error safe to retry automatically.
      if (
        error instanceof Error &&
        "code" in error &&
        (error.code === "AGENT_RUN_BUSY" || error.code === "AGENT_PROMPT_NOT_SUBMITTED")
      ) {
        await rm(file, { force: true });
      }
      throw error;
    }
    await writeJsonFileAtomic(file, { ...receipt, state: "completed" });
  }
}

async function readReceipt(file: string): Promise<z.infer<typeof ReceiptSchema> | null> {
  try {
    return ReceiptSchema.parse(JSON.parse(await readFile(file, "utf8")));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

function digest(value: unknown): string {
  return createHash("sha256")
    .update(
      JSON.stringify(value, (_key, candidate: unknown) => {
        if (candidate !== null && typeof candidate === "object" && !Array.isArray(candidate)) {
          return Object.fromEntries(
            Object.entries(candidate).sort(([a], [b]) => a.localeCompare(b)),
          );
        }
        return candidate;
      }),
    )
    .digest("hex");
}
