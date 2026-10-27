import {
  getAnswerAttention,
  type AnswerAttention,
  type CompanionEntry,
  type TimelineAnchor,
} from "@getpaseo/protocol/companion-stream";

export interface TrackedAnswer {
  entry: CompanionEntry;
  attention: AnswerAttention;
}

const ATTENTION_ORDER: Record<AnswerAttention, number> = {
  new_answer: 0,
  candidate: 1,
  waiting: 2,
};

/** Confirmed answers lead, then possible answers, then questions still waiting; newest first. */
export function selectTrackedAnswers(entries: readonly CompanionEntry[]): TrackedAnswer[] {
  const items: TrackedAnswer[] = [];
  for (const entry of entries) {
    const attention = getAnswerAttention(entry);
    if (attention) items.push({ entry, attention });
  }
  const time = (item: TrackedAnswer) =>
    Date.parse(item.entry.reply?.answeredAt ?? item.entry.timestamp) || 0;
  return items.sort(
    (a, b) => ATTENTION_ORDER[a.attention] - ATTENTION_ORDER[b.attention] || time(b) - time(a),
  );
}

/** One key per answer revision, so hiding the pane does not hide a revised answer. */
function answerKey(item: TrackedAnswer): string | null {
  return item.entry.reply && item.attention !== "waiting"
    ? `${item.entry.id}@${item.entry.reply.revision}`
    : null;
}

/**
 * Identifies the answers the pane is showing. Hiding lasts until an answer arrives (or is
 * revised) that was not among them; a new waiting question or marking one seen does not.
 */
export function trackedAnswersSignature(items: readonly TrackedAnswer[]): string {
  return items
    .flatMap((item) => answerKey(item) ?? [])
    .sort()
    .join("|");
}

/** True when `items` holds an answer that was not showing when the user hid the pane. */
export function hasUnhiddenAnswers(items: readonly TrackedAnswer[], hidden: string | null) {
  if (hidden === null) return true;
  const hiddenKeys = new Set(hidden.split("|"));
  return items.some((item) => {
    const key = answerKey(item);
    return key !== null && !hiddenKeys.has(key);
  });
}

/** One Stream entry per tracked message: the same message tracked twice is the same entry. */
export function trackedQuestionEntryId(cursor: { epoch: string; seq: number }): string {
  return `${cursor.epoch}:${cursor.seq}`.slice(0, 200);
}

export interface TrackedAnswerLinks {
  questionAnchor?: TimelineAnchor;
  /** A tracked ask's originating chat message; it has no timeline position. */
  questionMessageId?: string;
  answerAnchor?: TimelineAnchor;
  /** The chat that wrote the answer, when it is not the one showing the pane. */
  answeringAgentId?: string;
}

/** Where a row's question and answer live, for its jump and open-chat actions. */
export function trackedAnswerLinks(entry: CompanionEntry, agentId: string): TrackedAnswerLinks {
  const answeredBy = entry.reply?.answeredByAgentId;
  return {
    questionAnchor: entry.kind === "q_and_a" ? entry.questionAnchor : undefined,
    questionMessageId: entry.kind === "question" ? entry.ask?.sourceMessageId : undefined,
    answerAnchor: entry.reply?.anchor,
    answeringAgentId: answeredBy && answeredBy !== agentId ? answeredBy : undefined,
  };
}
