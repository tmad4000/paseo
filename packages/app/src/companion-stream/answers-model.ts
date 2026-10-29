import {
  getAnswerAttention,
  type AnswerAttention,
  type TrackedAskInput,
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

export type OpenAskState = Exclude<TrackedAskInput["state"], "done">;

export interface OpenAsk {
  entry: CompanionEntry;
  state: OpenAskState;
  /** First line of the ask's remaining work: what happens next. */
  nextAction: string;
  delegatedAgentId?: string;
}

const ASK_STATE_ORDER: Record<OpenAskState, number> = {
  blocked: 0,
  in_progress: 1,
  open: 2,
};

/** First non-empty line of an ask's remaining work. */
export function askNextAction(remaining: string): string {
  return (
    remaining
      .split("\n")
      .find((line) => line.trim())
      ?.trim() ?? ""
  );
}

/**
 * The chat's unresolved Stream asks, for the pane's Open asks section. Blocked asks lead (they
 * usually wait on the user), then work in progress, then open; newest first. Done asks never
 * show, nor do linked duplicates of a canonical task or asks already listed as questions.
 */
export function selectOpenAsks(
  entries: readonly CompanionEntry[],
  listedAsQuestions: ReadonlySet<string> = new Set(),
): OpenAsk[] {
  const items: OpenAsk[] = [];
  for (const entry of entries) {
    const ask = entry.ask;
    if (!ask || ask.state === "done" || ask.canonicalTask) continue;
    if (listedAsQuestions.has(entry.id)) continue;
    items.push({
      entry,
      state: ask.state,
      nextAction: askNextAction(ask.remaining),
      delegatedAgentId: ask.delegatedAgentId || undefined,
    });
  }
  const time = (item: OpenAsk) => Date.parse(item.entry.timestamp) || 0;
  return items.sort(
    (a, b) => ASK_STATE_ORDER[a.state] - ASK_STATE_ORDER[b.state] || time(b) - time(a),
  );
}

/** A newly blocked ask brings a hidden pane back; progress on other asks does not. */
function blockedAskKey(item: OpenAsk): string | null {
  return item.state === "blocked" ? `blocked:${item.entry.id}` : null;
}

/** Identifies what the pane is showing that should reopen it once hidden: answers and blocks. */
export function answersPaneSignature(
  answers: readonly TrackedAnswer[],
  asks: readonly OpenAsk[],
): string {
  return [trackedAnswersSignature(answers), ...asks.flatMap((item) => blockedAskKey(item) ?? [])]
    .filter(Boolean)
    .sort()
    .join("|");
}

/** True when the pane holds an answer or blocked ask that was not showing when it was hidden. */
export function hasUnhiddenPaneItems(
  answers: readonly TrackedAnswer[],
  asks: readonly OpenAsk[],
  hidden: string | null,
): boolean {
  if (hidden === null) return true;
  if (hasUnhiddenAnswers(answers, hidden)) return true;
  const hiddenKeys = new Set(hidden.split("|"));
  return asks.some((item) => {
    const key = blockedAskKey(item);
    return key !== null && !hiddenKeys.has(key);
  });
}
