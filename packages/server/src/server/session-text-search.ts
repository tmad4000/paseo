import { setImmediate } from "node:timers/promises";
import type { SessionTextSearchHit } from "@getpaseo/protocol/messages";

/**
 * Lexical message search behind the sidebar filter's "In messages" tier. It runs on every pause in
 * typing, so unlike `session.search` it never calls a model: it is a bounded, case-insensitive
 * substring scan over each session's recent messages — the daemon's timeline for loaded agents,
 * the provider transcript for the rest (`session-text-history.ts`), supplied by `readMessages`.
 *
 * Every bound exists so a long history cannot turn typing into daemon work. The caller passes the
 * candidates (scope and exclusions are its job); this module decides how many of them to read, in
 * which order, and when to stop.
 */
export const SESSION_TEXT_SEARCH_LIMITS = {
  /** Most recently active sessions read per request. */
  maxSessions: 200,
  /** Hits kept per session, newest first. One noisy chat must not fill the list. */
  maxHitsPerSession: 3,
  /** Hits returned per request. */
  maxHits: 50,
  /** Wall-clock budget per request. Reaching it returns what was found so far as `truncated`. */
  budgetMs: 1000,
  /** Snippet length, ellipses included. */
  snippetLength: 160,
} as const;

export interface SessionTextSearchCandidate {
  agentId: string;
  workspaceId: string;
  workspaceTitle: string;
  projectName: string;
  title: string;
  provider: string;
  /** ISO timestamp used to choose which sessions to read first. */
  activityAt: string;
}

export interface SessionTextSearchMessage {
  text: string;
  role: "user" | "assistant";
  timestamp?: string;
  seq?: number;
}

export interface SessionTextSearchInput {
  query: string;
  candidates: readonly SessionTextSearchCandidate[];
  /** Conversation messages for one session, oldest first. */
  readMessages: (agentId: string) => Promise<SessionTextSearchMessage[]>;
  signal?: AbortSignal;
  now?: () => number;
  limits?: Partial<typeof SESSION_TEXT_SEARCH_LIMITS>;
}

export interface SessionTextSearchResult {
  hits: SessionTextSearchHit[];
  searchedCount: number;
  totalCount: number;
  truncated: boolean;
}

/** NFKC, collapsed whitespace, trimmed. Case is handled by the `iu` pattern. */
export function normalizeSessionTextQuery(query: string): string {
  return query.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function buildPattern(normalizedQuery: string): RegExp {
  const source = normalizedQuery
    .split(" ")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(" ");
  return new RegExp(source, "iu");
}

/**
 * Cut a window of at most `maxLength` characters around a match, preferring word boundaries and
 * marking cut edges with an ellipsis. Offsets in the result refer to the returned snippet.
 */
export function buildSessionTextSnippet(input: {
  text: string;
  matchIndex: number;
  matchLength: number;
  maxLength?: number;
}): { snippet: string; matchStart: number; matchLength: number } {
  const maxLength = input.maxLength ?? SESSION_TEXT_SEARCH_LIMITS.snippetLength;
  const { text } = input;
  const matchLength = Math.min(input.matchLength, maxLength - 2);
  if (text.length <= maxLength) {
    return { snippet: text, matchStart: input.matchIndex, matchLength };
  }
  // Two characters are reserved for the ellipses so the result never exceeds `maxLength`.
  const room = maxLength - 2 - matchLength;
  let start = Math.max(0, input.matchIndex - Math.floor(room / 2));
  let end = Math.min(text.length, start + maxLength - 2);
  start = Math.max(0, end - (maxLength - 2));
  // Snap to a nearby space so the snippet does not open or close mid-word, without giving up the
  // match or more than a few characters of context.
  const snapWindow = 12;
  if (start > 0) {
    const space = text.indexOf(" ", start);
    if (space !== -1 && space < input.matchIndex && space - start <= snapWindow) start = space + 1;
  }
  if (end < text.length) {
    const space = text.lastIndexOf(" ", end);
    if (space > input.matchIndex + matchLength && end - space <= snapWindow) end = space;
  }
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return {
    snippet: `${prefix}${text.slice(start, end)}${suffix}`,
    matchStart: input.matchIndex - start + prefix.length,
    matchLength,
  };
}

function activityTime(candidate: SessionTextSearchCandidate): number {
  const time = Date.parse(candidate.activityAt);
  return Number.isFinite(time) ? time : 0;
}

function hitTime(hit: SessionTextSearchHit): number {
  const time = hit.timestamp ? Date.parse(hit.timestamp) : NaN;
  return Number.isFinite(time) ? time : 0;
}

export async function searchSessionText(
  input: SessionTextSearchInput,
): Promise<SessionTextSearchResult> {
  const limits = { ...SESSION_TEXT_SEARCH_LIMITS, ...input.limits };
  const now = input.now ?? (() => performance.now());
  const query = normalizeSessionTextQuery(input.query);
  const totalCount = input.candidates.length;
  if (!query) return { hits: [], searchedCount: 0, totalCount, truncated: false };

  const pattern = buildPattern(query);
  const startedAt = now();
  const ordered = [...input.candidates].sort((a, b) => activityTime(b) - activityTime(a));
  let truncated = ordered.length > limits.maxSessions;
  const hits: SessionTextSearchHit[] = [];
  let searchedCount = 0;

  for (const candidate of ordered.slice(0, limits.maxSessions)) {
    input.signal?.throwIfAborted();
    if (now() - startedAt >= limits.budgetMs || hits.length >= limits.maxHits) {
      truncated = true;
      break;
    }
    const messages = await input.readMessages(candidate.agentId);
    input.signal?.throwIfAborted();
    searchedCount += 1;
    let sessionHits = 0;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]!;
      const flat = message.text.normalize("NFKC").replace(/\s+/g, " ").trim();
      const match = pattern.exec(flat);
      if (!match) continue;
      const snippet = buildSessionTextSnippet({
        text: flat,
        matchIndex: match.index,
        matchLength: match[0].length,
        maxLength: limits.snippetLength,
      });
      hits.push({
        agentId: candidate.agentId,
        workspaceId: candidate.workspaceId,
        workspaceTitle: candidate.workspaceTitle,
        projectName: candidate.projectName,
        title: candidate.title,
        provider: candidate.provider,
        role: message.role,
        ...snippet,
        ...(message.timestamp ? { timestamp: message.timestamp } : {}),
        ...(message.seq !== undefined ? { seq: message.seq } : {}),
      });
      sessionHits += 1;
      if (sessionHits >= limits.maxHitsPerSession) break;
    }
    // Reading a session is synchronous work after the store read; yield so a long scan never
    // holds the daemon's event loop for the whole budget.
    await setImmediate();
  }

  hits.sort((a, b) => hitTime(b) - hitTime(a));
  if (hits.length > limits.maxHits) truncated = true;
  return { hits: hits.slice(0, limits.maxHits), searchedCount, totalCount, truncated };
}
