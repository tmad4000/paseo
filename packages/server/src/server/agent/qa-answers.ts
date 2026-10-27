import type { CompanionEntry, TimelineAnchor } from "@getpaseo/protocol/companion-stream";
import type { AgentTimelineItem } from "./agent-sdk-types.js";
import { COMPANION_TEXT_LIMIT } from "./companion-stream.js";

/** The projected timeline fields an answer needs; a row covers seqStart..seqEnd. */
export interface AnswerTimelineRow {
  item: AgentTimelineItem;
  seqStart: number;
  seqEnd: number;
}

/** Turn failures are recorded as assistant rows with this prefix (agent-manager); never an answer. */
const SYSTEM_ERROR_PREFIX = "[System Error]";

interface FoundAnswer {
  /** Bounded like other Stream text; Chat holds the full reply. */
  text: string;
  anchor: TimelineAnchor;
  messageId?: string;
}

/**
 * Attach the reply to each tracked question that has none yet. The reply is the final
 * response after the question: assistant messages following the last tool call, before the
 * next user message. Narration before a tool call is progress, not an answer.
 *
 * A reply still being written is not attached: the span must be closed by a later user
 * message or by a completed turn. An attached answer is never replaced, and an arriving
 * answer leaves the entry unseen. Only the asker marks it seen. A question the asker stopped
 * tracking (done) stays closed.
 *
 * A new timeline epoch (daemon restart, history reload) renumbers rows. The question is
 * found again by its provider message id when it has one; otherwise it keeps waiting.
 */
export function attachQAndAAnswers(input: {
  entries: CompanionEntry[];
  rows: readonly AnswerTimelineRow[];
  epoch: string;
  turnSettled: boolean;
  now: string;
}): CompanionEntry[] {
  let changed = false;
  const next = input.entries.map((entry) => {
    if (entry.kind !== "q_and_a" || entry.answer?.trim() || entry.status === "done") return entry;
    const questionAnchor = currentQuestionAnchor(entry, input.rows, input.epoch);
    if (!questionAnchor) return entry;
    const found = findAnswer(input.rows, questionAnchor, input.epoch, input.turnSettled);
    if (!found) return entry;
    changed = true;
    return {
      ...entry,
      questionAnchor,
      answer: found.text,
      answerAnchor: found.anchor,
      ...(found.messageId ? { answerMessageId: found.messageId } : {}),
      answeredAt: input.now,
      status: "open" as const,
    };
  });
  return changed ? next : input.entries;
}

function currentQuestionAnchor(
  entry: Extract<CompanionEntry, { kind: "q_and_a" }>,
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

function findAnswer(
  rows: readonly AnswerTimelineRow[],
  question: TimelineAnchor,
  epoch: string,
  turnSettled: boolean,
): FoundAnswer | null {
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
