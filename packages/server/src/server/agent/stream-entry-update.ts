import { randomUUID } from "node:crypto";
import type { CompanionEntry } from "@getpaseo/protocol/companion-stream";
import type { StreamEntryUpdate } from "@getpaseo/protocol/global-stream";
import { retainCompanionEntries } from "./companion-stream.js";

export function applyStreamEntryUpdate(
  entries: CompanionEntry[],
  input: StreamEntryUpdate,
): CompanionEntry[] {
  if (input.action === "update_status") {
    if (!input.status) throw new Error("Status is required");
    const target = entries.find((entry) => entry.id === input.entryId);
    if (!target || (target.kind !== "question" && target.kind !== "feature_request"))
      throw new Error("Stream item no longer exists or cannot be changed");
    return retainCompanionEntries(
      entries.map((entry) => (entry === target ? { ...target, status: input.status! } : entry)),
    );
  }
  if (input.action === "remove_pin") {
    if (!entries.some((entry) => entry.id === input.entryId && entry.kind === "pin"))
      throw new Error("Pinned item no longer exists");
    return entries.filter((entry) => entry.id !== input.entryId);
  }
  const text = input.text?.trim();
  if (!text || text.length > 4000) throw new Error("Enter between 1 and 4000 characters");
  const entry = createEntry(entries, input, text);
  const exists = entries.some((item) => item.id === entry.id);
  return retainCompanionEntries(
    exists ? entries.map((item) => (item.id === entry.id ? entry : item)) : [...entries, entry],
  );
}

function createEntry(
  entries: CompanionEntry[],
  input: StreamEntryUpdate,
  text: string,
): CompanionEntry {
  const common = { timestamp: new Date().toISOString(), text, truncated: false };
  switch (input.action) {
    case "add_question": {
      const id = `question:${input.entryId ?? randomUUID()}`;
      const existing = entries.find((entry) => entry.id === id);
      return {
        ...common,
        id,
        timestamp: existing?.timestamp ?? common.timestamp,
        kind: "question",
        status: input.status ?? "open",
      };
    }
    case "add_pin": {
      const id = `pin:${input.entryId ?? randomUUID()}`;
      return {
        ...common,
        id,
        timestamp: entries.find((entry) => entry.id === id)?.timestamp ?? common.timestamp,
        kind: "pin",
        sourceId: input.sourceId,
      };
    }
    case "add_q_and_a":
      return { ...common, id: `qa:${randomUUID()}`, kind: "q_and_a", answer: input.answerText };
    default:
      throw new Error("Unknown Stream action");
  }
}
