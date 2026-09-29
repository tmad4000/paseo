import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "vitest";

import { AgentQueueStore, type AgentQueueJournalEntry } from "./store.js";

test("journals complete queue states before they can be replaced", async () => {
  const dir = await mkdtemp(join(tmpdir(), "paseo-queue-journal-"));
  const store = new AgentQueueStore(dir);
  try {
    await store.mutate("agent-1", (current) => ({
      ...current,
      items: [{ id: "message-1", text: "keep this message", createdAt: new Date().toISOString() }],
    }));
    await store.mutate("agent-1", (current) => ({ ...current, items: [] }));

    const journalPath = join(dir, "agent-1.journal.jsonl");
    const entries = (await readFile(journalPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as AgentQueueJournalEntry);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.after.items[0]?.text).toBe("keep this message");
    expect(entries[1]?.before.items[0]?.text).toBe("keep this message");
    expect(entries[1]?.after.items).toEqual([]);
    expect((await store.get("agent-1")).items).toEqual([]);
    expect((await stat(journalPath)).mode & 0o077).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("keeps a previous journal when the current journal reaches its size limit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "paseo-queue-journal-rotate-"));
  const store = new AgentQueueStore(dir, 200);
  try {
    await store.mutate("agent-1", (current) => ({
      ...current,
      items: [{ id: "message-1", text: "original", createdAt: new Date().toISOString() }],
    }));
    await store.mutate("agent-1", (current) => ({ ...current, items: [] }));
    const previous = await readFile(join(dir, "agent-1.journal.previous.jsonl"), "utf8");
    const current = await readFile(join(dir, "agent-1.journal.jsonl"), "utf8");
    expect(JSON.parse(previous.trim()).after.items[0].text).toBe("original");
    expect(JSON.parse(current.trim()).before.items[0].text).toBe("original");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
