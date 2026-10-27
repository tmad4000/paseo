import { randomUUID } from "node:crypto";
import {
  TrackedAskInputSchema,
  type TrackedAskInput,
  type CompanionEntry,
} from "@getpaseo/protocol/companion-stream";
import type { StreamEntryUpdate } from "@getpaseo/protocol/global-stream";
import { parseStreamHashtags } from "@getpaseo/protocol/stream-tags";
import { retainCompanionEntries } from "./companion-stream.js";
import { markReplySeen, setExplicitReply } from "./stream-answers.js";

/** Tags parsed at write time; omitted when the text has none. */
function tagsFor(text: string): { tags?: string[] } {
  const tags = parseStreamHashtags(text);
  return tags.length ? { tags } : {};
}

export function applyStreamEntryUpdate(
  entries: CompanionEntry[],
  input: StreamEntryUpdate,
): CompanionEntry[] {
  if (input.action === "set_ask") return setAsk(entries, input);
  if (input.action === "update_status") return updateStatus(entries, input);
  if (input.action === "set_reply")
    return setExplicitReply(entries, input, new Date().toISOString());
  if (input.action === "mark_reply_seen") return markReplySeen(entries, input);
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

function updateStatus(entries: CompanionEntry[], input: StreamEntryUpdate): CompanionEntry[] {
  if (!input.status) throw new Error("Status is required");
  const target = entries.find((entry) => entry.id === input.entryId);
  if (target?.kind === "q_and_a") return setQAndAStatus(entries, target, input.status);
  if (!target || (target.kind !== "question" && target.kind !== "feature_request"))
    throw new Error("Stream item no longer exists or cannot be changed");
  if (target.ask) {
    if (input.status === "done" && target.ask.state !== "done")
      throw new Error("Use set_stream_ask with completion evidence to mark this ask done");
    const state = ({ open: "open", reviewed: "in_progress", done: "done" } as const)[input.status];
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

function createEntry(
  entries: CompanionEntry[],
  input: StreamEntryUpdate,
  text: string,
): CompanionEntry {
  const common = { timestamp: new Date().toISOString(), text, truncated: false, ...tagsFor(text) };
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
      return createQAndA(entries, input, common);
    default:
      throw new Error("Unknown Stream action");
  }
}

type QAndAEntry = Extract<CompanionEntry, { kind: "q_and_a" }>;

/** Stop (done) or resume (open) tracking a Q&A message. Seen is mark_reply_seen, not a status. */
function setQAndAStatus(
  entries: CompanionEntry[],
  target: QAndAEntry,
  status: "open" | "reviewed" | "done",
): CompanionEntry[] {
  if (status === "reviewed") throw new Error("Mark the answer seen instead");
  return entries.map((entry) => (entry === target ? { ...target, status } : entry));
}

function createQAndA(
  entries: CompanionEntry[],
  input: StreamEntryUpdate,
  common: Pick<QAndAEntry, "timestamp" | "text" | "truncated" | "tags">,
): CompanionEntry {
  // A stable ID makes tracking the same message again a no-op instead of a second card.
  const id = `qa:${input.entryId ?? randomUUID()}`;
  const existing = entries.find((entry) => entry.id === id);
  if (existing?.kind === "q_and_a") return existing;
  const questionMessageId = input.sourceId?.startsWith("msg:")
    ? input.sourceId.slice(4)
    : undefined;
  return {
    ...common,
    id,
    kind: "q_and_a",
    answer: input.answerText,
    ...(questionMessageId ? { questionMessageId } : {}),
    ...(input.questionAnchor ? { questionAnchor: input.questionAnchor } : {}),
  };
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
    ...tagsFor(input.text.trim()),
    status: ask.state === "done" ? "done" : "open",
    ...answerStateOf(previous),
    ask: {
      state: ask.state,
      remaining: ask.remaining,
      evidence: ask.evidence,
      sourceMessageId: ask.sourceMessageId,
      delegatedAgentId: ask.delegatedAgentId,
      subtasks: ask.subtasks,
      expectsAnswer: ask.expectsAnswer,
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

/** The answer and its seen state belong to the question, not to one revision of the ask. */
function answerStateOf(
  previous: CompanionEntry | undefined,
): Pick<CompanionEntry, "reply" | "replySeenRevision"> {
  if (!previous?.reply) return {};
  return { reply: previous.reply, replySeenRevision: previous.replySeenRevision };
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
