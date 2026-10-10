import { randomUUID } from "node:crypto";
import {
  TrackedAskInputSchema,
  type TrackedAskInput,
  type CompanionEntry,
} from "@getpaseo/protocol/companion-stream";
import type { StreamEntryUpdate } from "@getpaseo/protocol/global-stream";
import { retainCompanionEntries } from "./companion-stream.js";

export function applyStreamEntryUpdate(
  entries: CompanionEntry[],
  input: StreamEntryUpdate,
): CompanionEntry[] {
  if (input.action === "review_message") return reviewMessage(entries, input);
  if (input.action === "set_ask") return setAsk(entries, input);
  if (input.action === "update_status") {
    if (!input.status) throw new Error("Status is required");
    const target = entries.find((entry) => entry.id === input.entryId);
    if (!target || (target.kind !== "question" && target.kind !== "feature_request"))
      throw new Error("Stream item no longer exists or cannot be changed");
    if (target.messageReview)
      throw new Error(
        "Review this source message and record its individual asks; message review is not task completion",
      );
    if (target.ask) {
      if (input.status === "done" && target.ask.state !== "done")
        throw new Error("Use set_stream_ask with completion evidence to mark this ask done");
      const state = ({ open: "open", reviewed: "in_progress", done: "done" } as const)[
        input.status
      ];
      return setAsk(entries, {
        ...input,
        entryId: target.id.slice(4),
        text: target.text,
        // COMPAT(askRevision): added fork beta.11; remove after 2027-04-07 when old question clients are retired.
        expectedRevision: input.expectedRevision ?? target.ask.revision,
        ask: { ...target.ask, state },
      });
    }
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

function setAsk(entries: CompanionEntry[], input: StreamEntryUpdate): CompanionEntry[] {
  if (!input.entryId?.trim() || !input.ask || !input.text?.trim())
    throw new Error("Ask ID, text and explicit state are required");
  if (input.text.length > 4000 || input.entryId.length > 200)
    throw new Error("Ask text or ID is too long");
  const id = `ask:${input.entryId}`;
  const previous = entries.find((entry) => entry.id === id);
  const ask = TrackedAskInputSchema.parse(input.ask);
  validateAskCompletion(ask);
  const revision = previous?.ask?.revision ?? 0;
  const entry: CompanionEntry = {
    id,
    kind: "question",
    timestamp: previous?.timestamp ?? new Date().toISOString(),
    text: input.text.trim(),
    truncated: false,
    status: ask.state === "done" ? "done" : "open",
    source: findAskSource(entries, ask.sourceMessageId),
    ask: {
      state: ask.state,
      remaining: ask.remaining,
      evidence: ask.evidence,
      sourceMessageId: ask.sourceMessageId,
      delegatedAgentId: ask.delegatedAgentId,
      subtasks: ask.subtasks,
      revision,
      provenance: "explicit",
    },
  };
  if (
    previous?.ask &&
    previous.text === entry.text &&
    JSON.stringify(TrackedAskInputSchema.parse(previous.ask)) === JSON.stringify(ask)
  )
    return entries;
  if (input.expectedRevision !== revision)
    throw new Error(
      `Ask revision conflict: expectedRevision must be ${revision}; read the ask before updating`,
    );
  entry.ask!.revision = revision + 1;
  return previous ? entries.map((item) => (item.id === id ? entry : item)) : [...entries, entry];
}

function validateAskCompletion(ask: TrackedAskInput): void {
  if (
    ask.state === "done" &&
    (!ask.evidence.trim() || ask.remaining.trim() || ask.subtasks?.some((task) => !task.done))
  )
    throw new Error("Done requires evidence, no remaining work and all subtasks done");
  if (ask.state === "blocked" && !ask.remaining.trim())
    throw new Error("Describe what blocks this ask in remaining");
  if (new Set(ask.subtasks?.map((task) => task.id)).size !== (ask.subtasks?.length ?? 0))
    throw new Error("Subtask IDs must be unique");
}

function reviewMessage(entries: CompanionEntry[], input: StreamEntryUpdate): CompanionEntry[] {
  const previous = entries.find((entry) => entry.id === input.entryId);
  if (!previous?.messageReview || !input.review)
    throw new Error("Source message review is required");
  const { review } = input;
  if (review.state === "reviewed" && !review.note.trim())
    throw new Error("Explain the review, including when this message contains no asks");
  for (const id of review.askIds) {
    const ask = entries.find((entry) => entry.id === `ask:${id}`);
    if (!ask?.ask || ask.ask.sourceMessageId !== previous.source?.messageId)
      throw new Error("Every linked ask must reference this source message");
  }
  const next = { ...review, revision: previous.messageReview.revision };
  if (
    JSON.stringify(next) ===
    JSON.stringify({
      state: previous.messageReview.state,
      note: previous.messageReview.note,
      askIds: previous.messageReview.askIds,
      revision: previous.messageReview.revision,
    })
  )
    return entries;
  if (input.expectedRevision !== previous.messageReview.revision)
    throw new Error("Message review revision conflict; read it before updating");
  return entries.map((entry) =>
    entry === previous
      ? { ...entry, messageReview: { ...next, revision: next.revision + 1 } }
      : entry,
  );
}

function findAskSource(entries: CompanionEntry[], messageId: string | undefined) {
  if (!messageId) return undefined;
  const source = entries.find(
    (item) => item.messageReview && item.source?.messageId === messageId,
  )?.source;
  if (!source) return undefined;
  // Provenance aliases only identify the source record; asks need its position.
  const { aliases: _aliases, ...position } = source;
  return position;
}
