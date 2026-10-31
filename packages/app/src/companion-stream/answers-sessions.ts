import type { CompanionEntry } from "@getpaseo/protocol/companion-stream";
import type { StreamItem } from "@/types/stream";

/** More than this much quiet between real messages starts a new session. */
export const SESSION_IDLE_GAP_MS = 2 * 60 * 60 * 1000;

/** A person's prompt or the assistant's reply, as the session rule sees it. */
export interface ChatMessageEvent {
  role: "user" | "assistant";
  /** Epoch milliseconds. */
  time: number;
  /** Ids and timeline positions a pane entry may point at this message by. */
  keys: readonly string[];
  /** A `<paseo-system>` envelope: heartbeats, schedules and other injected notifications. */
  system?: boolean;
  /** Carries another chat's history: the first message of a fork. */
  forkContext?: boolean;
}

/**
 * How a session began: the chat's first message, more than the idle gap of quiet, a message
 * carrying a forked chat's history, or unknown because older messages are not loaded yet.
 */
export type SessionOrigin = "start" | "idle" | "fork" | "partial";

export interface ChatSession {
  start: number;
  end: number;
  origin: SessionOrigin;
  /** The quiet before an idle session, in milliseconds. */
  idleMs?: number;
}

export interface ChatSessions {
  sessions: readonly ChatSession[];
  /** When this chat's own history begins after inherited fork history, if it is a fork. */
  forkAt: number | null;
  /** Message times by id and timeline position, so entries can be placed by their source. */
  times: ReadonlyMap<string, number>;
}

const SYSTEM_ENVELOPE = /^<paseo-system>\n[\s\S]*\n<\/paseo-system>$/;

export function messageKey(id: string): string {
  return `msg:${id}`;
}

export function cursorKey(epoch: string, seq: number): string {
  return `cursor:${epoch}:${seq}`;
}

function eventKeys(item: {
  id: string;
  messageId?: string;
  clientMessageId?: string;
  timelineCursor?: { epoch: string; seq: number };
}): string[] {
  const keys = [messageKey(item.id)];
  if (item.messageId) keys.push(messageKey(item.messageId));
  if (item.clientMessageId) keys.push(messageKey(item.clientMessageId));
  if (item.timelineCursor) {
    keys.push(cursorKey(item.timelineCursor.epoch, item.timelineCursor.seq));
  }
  return keys;
}

/**
 * The chat's real messages in timeline order. Thoughts, tool calls, notifications and other
 * rows never count, and messages without a usable timestamp are left out.
 */
export function chatMessageEvents(items: readonly StreamItem[]): ChatMessageEvent[] {
  const events: ChatMessageEvent[] = [];
  for (const item of items) {
    if (item.kind !== "user_message" && item.kind !== "assistant_message") continue;
    const time = item.timestamp instanceof Date ? item.timestamp.getTime() : Number.NaN;
    if (!Number.isFinite(time)) continue;
    if (item.kind === "assistant_message") {
      events.push({ role: "assistant", time, keys: eventKeys(item) });
      continue;
    }
    events.push({
      role: "user",
      time,
      keys: eventKeys(item),
      system: SYSTEM_ENVELOPE.test(item.text.trim()),
      forkContext: (item.attachments ?? []).some(
        (attachment) => attachment.type === "text" && attachment.contextKind === "chat_history",
      ),
    });
  }
  return events;
}

/**
 * Splits the whole chat into sessions before anything is filtered for display, so the pane's
 * hidden rows (seen answers, finished asks) can never create or hide a break. A session starts
 * at the first message, after more than `idleGapMs` without a real message, or at a message
 * that brings in a forked chat's history. System-injected prompts and the assistant's replies
 * to them are noise: they neither keep a session alive nor start one.
 */
export function computeChatSessions(
  events: readonly ChatMessageEvent[],
  options: { historyComplete: boolean; idleGapMs?: number },
): ChatSessions {
  const idleGapMs = options.idleGapMs ?? SESSION_IDLE_GAP_MS;
  const sessions: ChatSession[] = [];
  const times = new Map<string, number>();
  let forkAt: number | null = null;
  // Until a user message is seen in a window that starts mid-history, the prompt that led the
  // first replies is unloaded and may have been a heartbeat, so those replies do not count.
  let systemTurn = !options.historyComplete;
  for (const event of events) {
    for (const key of event.keys) times.set(key, event.time);
    if (event.role === "user") systemTurn = Boolean(event.system);
    if (systemTurn) continue;
    const last = sessions.at(-1);
    if (event.forkContext) {
      forkAt ??= event.time;
      sessions.push({ start: event.time, end: event.time, origin: "fork" });
    } else if (!last) {
      sessions.push({
        start: event.time,
        end: event.time,
        origin: options.historyComplete ? "start" : "partial",
      });
    } else if (event.time - last.end > idleGapMs) {
      sessions.push({
        start: event.time,
        end: event.time,
        origin: "idle",
        idleMs: event.time - last.end,
      });
    } else {
      last.end = Math.max(last.end, event.time);
    }
  }
  return { sessions, forkAt, times };
}

/**
 * Everything placement depends on: each session's start, origin and quiet, the fork point, and
 * how many message positions are known. A session's moving end does not change any placement.
 */
export function sessionsSignature(chat: ChatSessions): string {
  const sessions = chat.sessions.map((s) => `${s.start}:${s.origin}:${s.idleMs ?? ""}`).join("|");
  return `${sessions}#${chat.forkAt ?? ""}#${chat.times.size}`;
}

/**
 * When a pane entry happened: its source message's time when the chat has it loaded, else the
 * entry's own timestamp, else unknown.
 */
export function entryTime(
  entry: CompanionEntry,
  times: ReadonlyMap<string, number>,
): number | null {
  const keys: string[] = [];
  if (entry.kind === "q_and_a") {
    if (entry.questionAnchor) {
      keys.push(cursorKey(entry.questionAnchor.epoch, entry.questionAnchor.startSeq));
    }
    if (entry.questionMessageId) keys.push(messageKey(entry.questionMessageId));
  }
  if (entry.ask?.sourceMessageId) keys.push(messageKey(entry.ask.sourceMessageId));
  for (const key of keys) {
    const time = times.get(key);
    if (time !== undefined) return time;
  }
  const own = Date.parse(entry.timestamp);
  return Number.isFinite(own) ? own : null;
}

/**
 * Where an entry sits: its session (`session` on the session's first day, `day` on a later
 * calendar day the session ran into), history inherited from a fork's parent, messages older
 * than the loaded history, or an unknown time.
 */
export type PaneSegmentKind = "session" | "day" | "inherited" | "earlier" | "unknown";

export interface PaneSegment {
  key: string;
  kind: PaneSegmentKind;
  /** What the divider names: the session's start, or the start of the local day. */
  time: number | null;
  session?: ChatSession;
  /** Newest first. */
  sortKey: number;
}

/** A local calendar day, so midnight is the user's midnight. */
export function localDayKey(time: number): string {
  const date = new Date(time);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export function startOfLocalDay(time: number): number {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

const UNKNOWN: PaneSegment = {
  key: "unknown",
  kind: "unknown",
  time: null,
  sortKey: Number.MIN_SAFE_INTEGER,
};

export function placeEntry(entry: CompanionEntry, chat: ChatSessions): PaneSegment {
  const time = entryTime(entry, chat.times);
  if (time === null) return UNKNOWN;
  const { sessions, forkAt } = chat;
  if (forkAt !== null && sessions[0]?.origin === "fork" && time < forkAt) {
    // Below every session of this chat, above unknown times.
    return {
      key: "inherited",
      kind: "inherited",
      time: null,
      sortKey: Number.MIN_SAFE_INTEGER + 1,
    };
  }
  let index = -1;
  for (let i = sessions.length - 1; i >= 0; i -= 1) {
    if (sessions[i]!.start <= time) {
      index = i;
      break;
    }
  }
  if (index < 0) {
    if (sessions.length > 0 && sessions[0]!.origin !== "partial") {
      // Logged just before the chat's first message, which is still the start of this chat.
      index = 0;
    } else {
      const day = startOfLocalDay(time);
      return { key: `earlier:${localDayKey(time)}`, kind: "earlier", time: day, sortKey: day };
    }
  }
  const session = sessions[index]!;
  if (localDayKey(time) === localDayKey(session.start)) {
    return {
      key: `session:${session.start}`,
      kind: "session",
      time: session.start,
      session,
      sortKey: session.start,
    };
  }
  const day = startOfLocalDay(time);
  return {
    key: `session:${session.start}:${localDayKey(time)}`,
    kind: "day",
    time: day,
    session,
    sortKey: day,
  };
}

export type SegmentedRow<T> =
  | { type: "divider"; segment: PaneSegment }
  | { type: "item"; item: T; segment: PaneSegment };

/**
 * Groups already-ordered items under their segments, newest segment first, keeping each
 * segment's items in their given order (so blocked asks still lead within a session).
 */
export function segmentRows<T>(
  items: readonly T[],
  segmentOf: (item: T) => PaneSegment,
): SegmentedRow<T>[] {
  const groups = new Map<string, { segment: PaneSegment; items: T[] }>();
  for (const item of items) {
    const segment = segmentOf(item);
    const group = groups.get(segment.key);
    if (group) group.items.push(item);
    else groups.set(segment.key, { segment, items: [item] });
  }
  const ordered = [...groups.values()].sort((a, b) => b.segment.sortKey - a.segment.sortKey);
  const rows: SegmentedRow<T>[] = [];
  for (const { segment, items: grouped } of ordered) {
    rows.push({ type: "divider", segment });
    for (const item of grouped) rows.push({ type: "item", item, segment });
  }
  return rows;
}
