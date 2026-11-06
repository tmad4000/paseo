import {
  isUserQuestionEntry,
  type CompanionEntry,
  type StreamReply,
  type TimelineAnchor,
} from "@getpaseo/protocol/companion-stream";
import type { StreamEntryUpdate } from "@getpaseo/protocol/global-stream";
import type { AgentTimelineItem } from "./agent-sdk-types.js";
import { COMPANION_TEXT_LIMIT } from "./companion-stream.js";

/** The projected timeline fields a candidate needs; a row covers seqStart..seqEnd. */
export interface AnswerTimelineRow {
  item: AgentTimelineItem;
  seqStart: number;
  seqEnd: number;
}

/** Turn failures are recorded as assistant rows with this prefix (agent-manager); never a reply. */
const SYSTEM_ERROR_PREFIX = "[System Error]";

type QAndAEntry = Extract<CompanionEntry, { kind: "q_and_a" }>;

interface FoundReply {
  /** Bounded like other Stream text; Chat holds the full reply. */
  text: string;
  anchor: TimelineAnchor;
  messageId?: string;
}

/**
 * Give each tracked Q&A message without a reply a candidate: the first settled response after
 * it, meaning assistant messages after the last tool call and before the next user message.
 * A candidate is a link to what the agent said, not a claim that it answered; "I'll check" is
 * a candidate too. Any explicit answer (set_stream_answer) replaces it, including a late one
 * given after more chat or by a delegated child. A candidate is never replaced by another
 * candidate, and arrival leaves it unseen.
 *
 * The span must be closed by a later user message or a completed turn. A new timeline epoch
 * renumbers rows; the question is found again by its provider message id when it has one.
 */
export function attachCandidateReplies(input: {
  entries: CompanionEntry[];
  rows: readonly AnswerTimelineRow[];
  epoch: string;
  turnSettled: boolean;
  now: string;
}): CompanionEntry[] {
  let changed = false;
  const next = input.entries.map((entry) => {
    if (entry.kind !== "q_and_a" || entry.reply || entry.status === "done") return entry;
    const questionAnchor = currentQuestionAnchor(entry, input.rows, input.epoch);
    if (!questionAnchor) return entry;
    const found = findReply(input.rows, questionAnchor, input.epoch, input.turnSettled);
    if (!found) return entry;
    changed = true;
    const reply: StreamReply = {
      text: found.text,
      provenance: "candidate",
      revision: 1,
      answeredAt: input.now,
      anchor: found.anchor,
      ...(found.messageId ? { messageId: found.messageId } : {}),
    };
    return { ...entry, questionAnchor, reply };
  });
  return changed ? next : input.entries;
}

/** Whether any tracked message still waits for a candidate, so the timeline is worth reading. */
export function hasCandidateWork(entries: readonly CompanionEntry[]): boolean {
  return entries.some(
    (entry) =>
      entry.kind === "q_and_a" && entry.questionAnchor && !entry.reply && entry.status !== "done",
  );
}

/**
 * Write an explicit answer onto a user question's own entry: a tracked ask or Q&A. Repeating
 * the same answer is a no-op; a changed answer needs the revision last read, so a stale writer
 * gets a conflict instead of overwriting. A new revision is unseen again; other entries and
 * the ask's own state are untouched.
 */
export function setExplicitReply(
  entries: CompanionEntry[],
  input: StreamEntryUpdate,
  now: string,
): CompanionEntry[] {
  const target = requireQuestion(entries, input.entryId);
  const text = input.text?.trim();
  if (!text || text.length > COMPANION_TEXT_LIMIT)
    throw new Error("Enter an answer between 1 and 4000 characters");
  if (input.replyRevision === undefined)
    throw new Error("replyRevision is required: the answer revision you last read, 0 for none");
  const current = target.reply;
  const messageId = input.sourceId?.startsWith("msg:") ? input.sourceId.slice(4) : undefined;
  if (
    current?.provenance === "explicit" &&
    current.text === text &&
    current.answeredByAgentId === input.answeredByAgentId &&
    current.messageId === messageId
  )
    return entries;
  const revision = current?.revision ?? 0;
  if (input.replyRevision !== revision)
    throw new Error(
      `Answer revision conflict: replyRevision must be ${revision}; read the entry before answering`,
    );
  const reply: StreamReply = {
    text,
    provenance: "explicit",
    revision: revision + 1,
    answeredAt: now,
    ...(input.answeredByAgentId ? { answeredByAgentId: input.answeredByAgentId } : {}),
    ...(messageId ? { messageId } : {}),
  };
  return entries.map((entry) => (entry === target ? { ...target, reply } : entry));
}

/** Record that the user has seen a reply revision. Seen never moves backwards. */
export function markReplySeen(
  entries: CompanionEntry[],
  input: StreamEntryUpdate,
): CompanionEntry[] {
  const target = requireQuestion(entries, input.entryId);
  if (!target.reply) throw new Error("This question has no answer to mark seen yet");
  const seen = input.replyRevision ?? target.reply.revision;
  if (seen > target.reply.revision) throw new Error("That answer revision does not exist");
  if ((target.replySeenRevision ?? 0) >= seen) return entries;
  return entries.map((entry) =>
    entry === target ? { ...target, replySeenRevision: seen } : entry,
  );
}

function requireQuestion(entries: CompanionEntry[], entryId: string | undefined): CompanionEntry {
  const target = entries.find((entry) => entry.id === entryId);
  if (!target) throw new Error("Stream item no longer exists");
  if (target.kind !== "q_and_a" && !(target.kind === "question" && target.ask))
    throw new Error("Answers attach to a tracked ask or Q&A, not to an agent's question");
  if (target.kind === "q_and_a" && !isUserQuestionEntry(target))
    throw new Error("This question is no longer tracked");
  return target;
}

function currentQuestionAnchor(
  entry: QAndAEntry,
  rows: readonly AnswerTimelineRow[],
  epoch: string,
): TimelineAnchor | null {
  if (!entry.questionAnchor) return null;
  if (entry.questionAnchor.epoch === epoch) return entry.questionAnchor;
  if (!entry.questionMessageId) return null;
  const row = rows.find(
    (candidate) =>
      candidate.item.type === "user_message" &&
      candidate.item.messageId === entry.questionMessageId,
  );
  return row ? { epoch, startSeq: row.seqStart, endSeq: row.seqEnd } : null;
}

function findReply(
  rows: readonly AnswerTimelineRow[],
  question: TimelineAnchor,
  epoch: string,
  turnSettled: boolean,
): FoundReply | null {
  const start = rows.findIndex(
    (row) =>
      row.item.type === "user_message" &&
      row.seqStart <= question.endSeq &&
      row.seqEnd >= question.startSeq,
  );
  if (start === -1) return null;
  let finalResponse: AnswerTimelineRow[] = [];
  let closed = turnSettled;
  for (const row of rows.slice(start + 1)) {
    if (row.item.type === "user_message") {
      closed = true;
      break;
    }
    if (row.item.type === "tool_call") finalResponse = [];
    else if (
      row.item.type === "assistant_message" &&
      row.item.text.trim() &&
      !row.item.text.startsWith(SYSTEM_ERROR_PREFIX)
    )
      finalResponse.push(row);
  }
  if (!closed || finalResponse.length === 0) return null;
  const full = finalResponse
    .map((row) => (row.item.type === "assistant_message" ? row.item.text.trim() : ""))
    .join("\n\n");
  const first = finalResponse[0];
  const last = finalResponse[finalResponse.length - 1];
  return {
    text: full.slice(0, COMPANION_TEXT_LIMIT),
    anchor: { epoch, startSeq: first.seqStart, endSeq: last.seqEnd },
    messageId: first.item.type === "assistant_message" ? first.item.messageId : undefined,
  };
}
