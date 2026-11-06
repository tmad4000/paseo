import type { CompanionEntry, TimelineAnchor } from "@getpaseo/protocol/companion-stream";
import type { AnswerTimelineRow } from "./stream-answers.js";

/** The chat message an entry names as its source, if any. */
export function entrySourceMessageId(entry: CompanionEntry): string | undefined {
  if (entry.ask?.sourceMessageId) return entry.ask.sourceMessageId;
  if (entry.inputRequest?.sourceMessageId) return entry.inputRequest.sourceMessageId;
  if (entry.kind === "q_and_a" && entry.questionMessageId) return entry.questionMessageId;
  if (entry.kind === "pin" && entry.sourceId?.startsWith("msg:")) {
    return entry.sourceId.slice(4) || undefined;
  }
  return undefined;
}

/** The rows of one message; an assistant message can span several block rows. */
function anchorForMessage(
  rows: readonly AnswerTimelineRow[],
  epoch: string,
  messageId: string,
): TimelineAnchor | null {
  let anchor: TimelineAnchor | null = null;
  for (const row of rows) {
    const item = row.item;
    if (item.type !== "user_message" && item.type !== "assistant_message") continue;
    const matches =
      item.messageId === messageId ||
      (item.type === "user_message" && item.clientMessageId === messageId);
    if (!matches) continue;
    anchor = anchor
      ? { epoch, startSeq: anchor.startSeq, endSeq: row.seqEnd }
      : { epoch, startSeq: row.seqStart, endSeq: row.seqEnd };
  }
  return anchor;
}

function latestUserMessageAnchor(
  rows: readonly AnswerTimelineRow[],
  epoch: string,
): TimelineAnchor | null {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row?.item.type === "user_message") {
      return { epoch, startSeq: row.seqStart, endSeq: row.seqEnd };
    }
  }
  return null;
}

/**
 * Give each entry this write created or changed a place in Chat. A named source message wins
 * when the loaded timeline has it. Otherwise an entry keeps the anchor it already had, since a
 * full ask replacement rebuilds the entry. A brand-new ask or input request whose source is not
 * found gets the latest user message: an agent records an ask while answering the message that
 * made it, and usually cannot know that message's id. Pins and Q&A are never guessed.
 */
export function attachSourceAnchors(input: {
  before: readonly CompanionEntry[];
  after: CompanionEntry[];
  /** Omitted when the chat's timeline is not loaded; existing anchors are still carried over. */
  timeline?: { rows: readonly AnswerTimelineRow[]; epoch: string } | null;
}): CompanionEntry[] {
  const previousById = new Map(input.before.map((entry) => [entry.id, entry]));
  let changed = false;
  const next = input.after.map((entry) => {
    const previous = previousById.get(entry.id);
    if (previous === entry) return entry;
    const anchor = resolveAnchor(entry, previous, input.timeline ?? null);
    if (!anchor || sameAnchor(anchor, entry.sourceAnchor)) return entry;
    changed = true;
    return { ...entry, sourceAnchor: anchor };
  });
  return changed ? next : input.after;
}

function resolveAnchor(
  entry: CompanionEntry,
  previous: CompanionEntry | undefined,
  timeline: { rows: readonly AnswerTimelineRow[]; epoch: string } | null,
): TimelineAnchor | undefined {
  const messageId = entrySourceMessageId(entry);
  if (timeline && messageId) {
    const named = anchorForMessage(timeline.rows, timeline.epoch, messageId);
    if (named) return named;
  }
  if (entry.sourceAnchor) return entry.sourceAnchor;
  if (previous?.sourceAnchor) return previous.sourceAnchor;
  if (previous || !timeline) return undefined;
  if (!entry.ask && !entry.inputRequest) return undefined;
  return latestUserMessageAnchor(timeline.rows, timeline.epoch) ?? undefined;
}

function sameAnchor(a: TimelineAnchor, b: TimelineAnchor | undefined): boolean {
  return !!b && a.epoch === b.epoch && a.startSeq === b.startSeq && a.endSeq === b.endSeq;
}
