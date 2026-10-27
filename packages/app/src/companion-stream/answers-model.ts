import {
  getQAndAAttention,
  type CompanionEntry,
  type QAndAAttention,
  type QAndAEntry,
} from "@getpaseo/protocol/companion-stream";

export interface TrackedAnswer {
  entry: QAndAEntry;
  attention: QAndAAttention;
}

/** New answers lead, newest first; questions still waiting follow, newest first. */
export function selectTrackedAnswers(entries: readonly CompanionEntry[]): TrackedAnswer[] {
  const items: TrackedAnswer[] = [];
  for (const entry of entries) {
    const attention = getQAndAAttention(entry);
    if (attention && entry.kind === "q_and_a") items.push({ entry, attention });
  }
  const time = (item: TrackedAnswer) =>
    Date.parse(item.entry.answeredAt ?? item.entry.timestamp) || 0;
  return items.sort(
    (a, b) =>
      Number(b.attention === "new_answer") - Number(a.attention === "new_answer") ||
      time(b) - time(a),
  );
}

/**
 * Identifies what the pane is showing. Hiding the pane lasts until this changes, so a new
 * question or a newly arrived answer brings it back; marking one seen does not.
 */
export function trackedAnswersSignature(items: readonly TrackedAnswer[]): string {
  return items
    .filter((item) => item.attention === "new_answer")
    .map((item) => item.entry.id)
    .sort()
    .join("|");
}

/** True when `current` shows something that was not in the signature the user hid. */
export function hasUnhiddenAnswers(items: readonly TrackedAnswer[], hidden: string | null) {
  if (hidden === null) return true;
  const hiddenIds = new Set(hidden.split("|"));
  return items.some((item) => item.attention === "new_answer" && !hiddenIds.has(item.entry.id));
}

/** One Stream entry per tracked message: the same message tracked twice is the same entry. */
export function trackedQuestionEntryId(cursor: { epoch: string; seq: number }): string {
  return `${cursor.epoch}:${cursor.seq}`.slice(0, 200);
}
