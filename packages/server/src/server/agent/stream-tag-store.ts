import { promises as fs } from "node:fs";
import { z } from "zod";
import {
  STREAM_PINNED_TAGS_MAX,
  normalizeStreamTag,
  normalizeStreamTags,
} from "@getpaseo/protocol/stream-tags";
import { writeJsonFileAtomic } from "../atomic-file.js";

const StoredStreamTagsSchema = z.object({
  version: z.literal(1),
  pinnedTags: z.array(z.string()),
});

/** Host-wide pinned Stream tags (`$PASEO_HOME/stream-tags.json`). Per-chat pins live on the agent record. */
export class StreamTagStore {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async getPinnedTags(): Promise<string[]> {
    await this.tail.catch(() => undefined);
    return this.read();
  }

  setPinned(tag: string, pinned: boolean): Promise<string[]> {
    const next = this.tail
      .catch(() => undefined)
      .then(async () => {
        const tags = applyTagPin(await this.read(), tag, pinned);
        await writeJsonFileAtomic(this.filePath, { version: 1, pinnedTags: tags });
        return tags;
      });
    this.tail = next;
    return next;
  }

  private async read(): Promise<string[]> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const parsed = StoredStreamTagsSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) throw new Error("Pinned Stream tags file is unreadable");
    return normalizeStreamTags(parsed.data.pinnedTags);
  }
}

/** Pinning appends (most recent last) and is idempotent; unpinning a missing tag is a no-op. */
export function applyTagPin(current: readonly string[], input: string, pinned: boolean): string[] {
  const tag = normalizeStreamTag(input);
  if (!tag) throw new Error("Tags use letters, digits, - and _, starting with a letter");
  const without = current.filter((item) => item !== tag);
  if (!pinned) return without;
  if (current.includes(tag)) return [...current];
  if (without.length >= STREAM_PINNED_TAGS_MAX)
    throw new Error(`Pin at most ${STREAM_PINNED_TAGS_MAX} tags`);
  return [...without, tag];
}
