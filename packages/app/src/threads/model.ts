import type { StreamItem } from "@/types/stream";

/**
 * Threaded replies (docs/threaded-replies.md). "Reply in thread" on an assistant reply starts a
 * new session that carries the chat up to that reply, opened beside the main session, which is
 * left untouched. The link is two labels on the thread session, so it needs no daemon change and
 * survives either session moving to another workspace or project: it names agents, not places.
 */
export const THREAD_PARENT_LABEL = "paseo.thread-parent";
export const THREAD_ANCHOR_LABEL = "paseo.thread-anchor";

/** What a thread hangs off: the parent session and the reply it answers. */
export interface ThreadOrigin {
  parentAgentId: string;
  anchor: string;
}

/**
 * The key of the reply a thread answers. The message id when the provider has one (stable across
 * reloads and rewinds of later turns); otherwise the reply's timeline position. Null for a
 * boundary with neither, which cannot anchor a thread.
 */
export function threadAnchorKey(boundary: {
  boundaryMessageId?: string;
  boundaryCursor?: { epoch: string; seq: number };
}): string | null {
  if (boundary.boundaryMessageId) return boundary.boundaryMessageId;
  if (boundary.boundaryCursor) {
    return `cursor:${boundary.boundaryCursor.epoch}:${boundary.boundaryCursor.seq}`;
  }
  return null;
}

export function threadLabels(origin: ThreadOrigin): Record<string, string> {
  return { [THREAD_PARENT_LABEL]: origin.parentAgentId, [THREAD_ANCHOR_LABEL]: origin.anchor };
}

export function threadOriginOf(
  agent: { labels?: Record<string, string> | null } | null | undefined,
): ThreadOrigin | null {
  const parentAgentId = agent?.labels?.[THREAD_PARENT_LABEL]?.trim();
  const anchor = agent?.labels?.[THREAD_ANCHOR_LABEL]?.trim();
  return parentAgentId && anchor ? { parentAgentId, anchor } : null;
}

export interface ThreadReply {
  agentId: string;
  title: string;
  createdAt: number;
}

export type ThreadRepliesByAnchor = ReadonlyMap<string, readonly ThreadReply[]>;

export const NO_THREAD_REPLIES: ThreadRepliesByAnchor = new Map();

interface ThreadCandidate {
  id: string;
  title?: string | null;
  createdAt: Date;
  archivedAt?: Date | null;
  labels?: Record<string, string> | null;
}

/** The parent's live threads grouped by the reply they answer, oldest first. */
export function collectThreadReplies(
  agents: Iterable<ThreadCandidate>,
  parentAgentId: string,
): ThreadRepliesByAnchor {
  const byAnchor = new Map<string, ThreadReply[]>();
  for (const agent of agents) {
    if (agent.archivedAt) continue;
    const origin = threadOriginOf(agent);
    if (!origin || origin.parentAgentId !== parentAgentId) continue;
    const reply: ThreadReply = {
      agentId: agent.id,
      title: agent.title?.trim() || agent.id.slice(0, 8),
      createdAt: agent.createdAt.getTime(),
    };
    const list = byAnchor.get(origin.anchor);
    if (list) list.push(reply);
    else byAnchor.set(origin.anchor, [reply]);
  }
  if (byAnchor.size === 0) return NO_THREAD_REPLIES;
  for (const list of byAnchor.values()) {
    list.sort(
      (left, right) =>
        left.createdAt - right.createdAt || left.agentId.localeCompare(right.agentId),
    );
  }
  return byAnchor;
}

export function threadRepliesEqual(left: ThreadRepliesByAnchor, right: ThreadRepliesByAnchor) {
  if (left === right) return true;
  if (left.size !== right.size) return false;
  for (const [anchor, leftList] of left) {
    const rightList = right.get(anchor);
    if (!rightList || rightList.length !== leftList.length) return false;
    for (let index = 0; index < leftList.length; index += 1) {
      if (
        leftList[index]!.agentId !== rightList[index]!.agentId ||
        leftList[index]!.title !== rightList[index]!.title
      )
        return false;
    }
  }
  return true;
}

/**
 * The thread's latest answer: every assistant block of its last turn, in order. Null while the
 * thread has not answered yet.
 */
export function latestAssistantReply(items: readonly StreamItem[]): string | null {
  let last = -1;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]!.kind === "assistant_message") {
      last = index;
      break;
    }
  }
  if (last < 0) return null;
  const lastItem = items[last]!;
  const turnId = lastItem.kind === "assistant_message" ? lastItem.turnId : undefined;
  const blocks: string[] = [];
  for (let index = last; index >= 0; index -= 1) {
    const item = items[index]!;
    if (item.kind === "user_message") break;
    if (item.kind !== "assistant_message") continue;
    if (turnId !== undefined && item.turnId !== undefined && item.turnId !== turnId) break;
    blocks.unshift(item.text);
  }
  const text = blocks.join("\n\n").trim();
  return text || null;
}

export const SEND_BACK_MAX_CHARS = 2000;

/**
 * What "Send back to main" queues in the parent: the thread's latest answer, quoted, with enough
 * provenance for the parent agent (or a person reading later) to find the thread.
 */
export function buildSendBackText(input: {
  threadTitle: string;
  threadAgentId: string;
  reply: string;
}): string {
  const trimmed = input.reply.trim();
  const clipped =
    trimmed.length > SEND_BACK_MAX_CHARS
      ? `${trimmed.slice(0, SEND_BACK_MAX_CHARS).trimEnd()}…`
      : trimmed;
  const quoted = clipped
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
  return [
    `From the side thread "${input.threadTitle}" (Paseo session ${input.threadAgentId}):`,
    "",
    quoted,
  ].join("\n");
}
