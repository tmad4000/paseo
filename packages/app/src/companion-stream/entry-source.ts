import type { CompanionEntry } from "@getpaseo/protocol/companion-stream";
import type { ChatJumpTarget } from "@/agent-stream/use-timeline-anchor-jump";

/** The chat message an entry names as its source: an ask's, a request's, or a pin's `msg:` id. */
function sourceMessageId(entry: CompanionEntry): string | undefined {
  if (entry.ask?.sourceMessageId) return entry.ask.sourceMessageId;
  if (entry.inputRequest?.sourceMessageId) return entry.inputRequest.sourceMessageId;
  if (entry.kind === "q_and_a" && entry.questionMessageId) return entry.questionMessageId;
  if (entry.kind === "pin" && entry.sourceId?.startsWith("msg:")) {
    return entry.sourceId.slice(4) || undefined;
  }
  return undefined;
}

/**
 * Where Show in chat takes an entry, or null when Chat has no place for it. A tracked question
 * keeps its own anchor; other entries use the host's source anchor (older hosts send none, so
 * only a loaded source message can be found).
 */
export function entryChatTarget(entry: CompanionEntry): ChatJumpTarget | null {
  const anchor =
    (entry.kind === "q_and_a" ? entry.questionAnchor : undefined) ?? entry.sourceAnchor;
  const messageId = sourceMessageId(entry);
  if (!anchor && !messageId) return null;
  return {
    ...(anchor ? { anchor } : {}),
    ...(messageId ? { messageId } : {}),
  };
}
