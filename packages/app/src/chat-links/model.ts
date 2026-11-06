import type { StreamItem, ToolCallItem } from "@/types/stream";
import { isHttpUrl } from "@/utils/http-url";

/**
 * Where a link first appeared. A URL first printed by a tool result (a `lavish-axi` session, a
 * `gh pr create` line) is `produced` even when the agent quotes it in prose afterwards.
 */
export type ChatLinkOrigin = "produced" | "agent" | "you";

export interface ChatLinkOccurrence {
  /** The timeline row's id, which is what the stream view scrolls to. */
  itemId: string;
  rowIndex: number;
  timestamp?: Date;
}

export interface ChatLink {
  /** Normalized for dedupe: lowercase scheme and host, one trailing slash trimmed. */
  key: string;
  /** First-seen exact text. */
  url: string;
  /** Markdown link text when any occurrence had one, else host and a shortened path. */
  label: string;
  /** The line the URL appeared in, minus the URL. */
  context: string;
  origin: ChatLinkOrigin;
  firstSeen: ChatLinkOccurrence;
  lastSeen: ChatLinkOccurrence;
  /**
   * Where Jump lands and the context line comes from: the first prose mention when there is one
   * (it reads better than a terminal line), else the first occurrence.
   */
  anchor: ChatLinkOccurrence;
  count: number;
}

export interface ChatLinkSection {
  origin: ChatLinkOrigin;
  links: ChatLink[];
}

interface FoundUrl {
  url: string;
  label: string | null;
  context: string;
}

interface ScannedText {
  text: string;
  origin: ChatLinkOrigin;
  /** Context for a URL that sits on a line of its own, e.g. a shell command. */
  fallbackContext?: string;
}

const CONTEXT_MAX_LENGTH = 90;
const SECTION_ORDER: readonly ChatLinkOrigin[] = ["produced", "agent", "you"];

// `[label](url)`; the URL may hold one level of balanced parentheses (Wikipedia-style paths).
const MARKDOWN_LINK = /\[([^\]\n]*)\]\((https?:\/\/[^\s()]*(?:\([^\s()]*\)[^\s()]*)*)\)/gi;
const BARE_URL = /https?:\/\/[^\s<>"'`]+/gi;
const TRAILING_PUNCTUATION = new Set([".", ",", ";", ":", ">", "'", '"', "]", "*", "!", "?"]);

function countChar(text: string, char: string): number {
  let count = 0;
  for (const value of text) if (value === char) count += 1;
  return count;
}

/** Trailing sentence punctuation, and a closing paren only when it has no opener in the URL. */
export function trimUrlPunctuation(raw: string): string {
  let url = raw;
  for (;;) {
    const last = url.at(-1);
    if (last === undefined) return url;
    if (TRAILING_PUNCTUATION.has(last)) {
      url = url.slice(0, -1);
      continue;
    }
    if (last === ")" && countChar(url, "(") < countChar(url, ")")) {
      url = url.slice(0, -1);
      continue;
    }
    return url;
  }
}

/** A URL inside CSS `url(...)` or a data URI is markup, not a link anyone shared. */
function isEmbeddedInMarkup(text: string, start: number): boolean {
  const before = text.slice(Math.max(0, start - 200), start);
  if (/url\(\s*["']?$/i.test(before)) return true;
  // Still inside a data URI: one opened earlier on the line and no quote or paren closed it.
  return /(?:^|["'(\s=])data:[^"')]*$/i.test(before);
}

function collapseContext(line: string): string {
  const collapsed = line
    .replace(/\s+/g, " ")
    .replace(/ ([.,;:!?])(?=\s|$)/g, "$1")
    .trim();
  if (collapsed.length <= CONTEXT_MAX_LENGTH) return collapsed;
  return `${collapsed.slice(0, CONTEXT_MAX_LENGTH - 1).trimEnd()}…`;
}

/** The line minus the URL; a markdown link keeps its label so the sentence still reads. */
function lineContext(line: string, match: string, replacement = " "): string {
  return collapseContext(line.replace(match, replacement).replace(/[[\]()]{2,}/g, " "));
}

/** Every http(s) URL in `text`, in order, with its markdown label and line context. */
export function findUrls(text: string): FoundUrl[] {
  if (!/https?:\/\//i.test(text)) return [];
  const found: FoundUrl[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!/https?:\/\//i.test(line)) continue;
    const covered: Array<[number, number]> = [];
    const lineFound: Array<{ index: number; item: FoundUrl }> = [];
    for (const match of line.matchAll(MARKDOWN_LINK)) {
      const index = match.index ?? 0;
      covered.push([index, index + match[0].length]);
      const url = match[2] ?? "";
      if (!isHttpUrl(url)) continue;
      const label = (match[1] ?? "").trim();
      lineFound.push({
        index,
        item: {
          url,
          label: label && label !== url ? label : null,
          context: lineContext(line, match[0], label ? ` ${label} ` : " "),
        },
      });
    }
    for (const match of line.matchAll(BARE_URL)) {
      const index = match.index ?? 0;
      if (covered.some(([start, end]) => index >= start && index < end)) continue;
      if (isEmbeddedInMarkup(line, index)) continue;
      const url = trimUrlPunctuation(match[0]);
      if (!isHttpUrl(url) || !/^https?:\/\/[^/?#]+/i.test(url)) continue;
      lineFound.push({ index, item: { url, label: null, context: lineContext(line, url) } });
    }
    lineFound.sort((left, right) => left.index - right.index);
    for (const { item } of lineFound) found.push(item);
  }
  return found;
}

export function normalizeLinkKey(url: string): string {
  const match = /^(https?:\/\/)([^/?#]*)(.*)$/i.exec(url);
  if (!match) return url;
  const rest = match[3] ?? "";
  const trimmed = rest.endsWith("/") ? rest.slice(0, -1) : rest;
  return `${(match[1] ?? "").toLowerCase()}${(match[2] ?? "").toLowerCase()}${trimmed}`;
}

export function linkHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const LONG_SEGMENT = 12;
const PATH_MAX_LENGTH = 40;

/** "m4-mini…:4387/session/87a7…" — enough to tell two links apart at a glance. */
export function shortLinkLabel(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const hostname = parsed.hostname.replace(/^www\./i, "");
  const labels = hostname.split(".");
  const host =
    labels.length > 2 && hostname.length > 20 && !/^\d+$/.test(labels[0] ?? "")
      ? `${labels[0]}…`
      : hostname;
  const port = parsed.port ? `:${parsed.port}` : "";
  const segments = parsed.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      const decoded = safeDecode(segment);
      return decoded.length > LONG_SEGMENT ? `${decoded.slice(0, 4)}…` : decoded;
    });
  let path = segments.length > 0 ? `/${segments.join("/")}` : "";
  if (path.length > PATH_MAX_LENGTH) path = `${path.slice(0, PATH_MAX_LENGTH - 1)}…`;
  return `${host}${port}${path}`;
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 1) ?? "";
  } catch {
    return "";
  }
}

function firstLine(text: string): string {
  return text.split(/\r?\n/, 1)[0] ?? "";
}

/** Tool results that print URLs. File bodies (read, edit, write) are noise and are skipped. */
function toolCallTexts(item: ToolCallItem): ScannedText[] {
  if (item.payload.source !== "agent") return [];
  const detail = item.payload.data.detail;
  switch (detail.type) {
    case "shell": {
      const command = collapseContext(firstLine(detail.command));
      return [
        { text: detail.command, origin: "produced", fallbackContext: command },
        { text: detail.output ?? "", origin: "produced", fallbackContext: command },
      ];
    }
    case "fetch":
      return [{ text: detail.url, origin: "produced", fallbackContext: detail.prompt ?? "" }];
    case "plain_text":
      return [{ text: detail.text ?? "", origin: "produced", fallbackContext: detail.label ?? "" }];
    case "sub_agent":
      return [{ text: detail.log, origin: "produced", fallbackContext: detail.description ?? "" }];
    case "unknown":
      return [{ text: stringify(detail.output), origin: "produced" }];
    default:
      return [];
  }
}

function rowTexts(item: StreamItem): ScannedText[] {
  switch (item.kind) {
    case "user_message":
      return [{ text: item.text, origin: "you" }];
    case "assistant_message":
      return [{ text: item.text, origin: "agent" }];
    case "tool_call":
      return toolCallTexts(item);
    default:
      return [];
  }
}

interface RowMatch {
  url: string;
  label: string | null;
  context: string;
  origin: ChatLinkOrigin;
}

// Rows are immutable and replaced when they change, so a row's matches are computed once. While
// the agent streams, only the rows that changed are rescanned.
const rowMatchCache = new WeakMap<StreamItem, RowMatch[]>();

function scanRow(item: StreamItem): RowMatch[] {
  const cached = rowMatchCache.get(item);
  if (cached) return cached;
  const matches: RowMatch[] = [];
  for (const scanned of rowTexts(item)) {
    for (const found of findUrls(scanned.text)) {
      matches.push({
        url: found.url,
        label: found.label,
        context: found.context || collapseContext(scanned.fallbackContext ?? ""),
        origin: scanned.origin,
      });
    }
  }
  rowMatchCache.set(item, matches);
  return matches;
}

/** True when any loaded row holds a link; stops at the first one. */
export function hasChatLinks(rows: readonly StreamItem[]): boolean {
  return rows.some((item) => scanRow(item).length > 0);
}

interface MutableLink extends ChatLink {
  hasProseAnchor: boolean;
}

/**
 * Every http(s) link in a chat's loaded timeline rows, in first-seen order. Pure: the panel
 * derives it from the rows array it already holds, so it updates as the agent streams.
 */
export function extractChatLinks(rows: readonly StreamItem[]): ChatLink[] {
  const byKey = new Map<string, MutableLink>();
  rows.forEach((item, rowIndex) => {
    const matches = scanRow(item);
    if (matches.length === 0) return;
    const occurrence: ChatLinkOccurrence = {
      itemId: item.id,
      rowIndex,
      ...("timestamp" in item && item.timestamp instanceof Date
        ? { timestamp: item.timestamp }
        : {}),
    };
    for (const match of matches) {
      const key = normalizeLinkKey(match.url);
      const isProse = match.origin !== "produced";
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, {
          key,
          url: match.url,
          label: match.label ?? "",
          context: match.context,
          origin: match.origin,
          firstSeen: occurrence,
          lastSeen: occurrence,
          anchor: occurrence,
          count: 1,
          hasProseAnchor: isProse,
        });
        continue;
      }
      existing.count += 1;
      existing.lastSeen = occurrence;
      if (!existing.label && match.label) existing.label = match.label;
      if (isProse && !existing.hasProseAnchor) {
        existing.hasProseAnchor = true;
        existing.anchor = occurrence;
        if (match.context) existing.context = match.context;
      } else if (!existing.context && match.context) {
        existing.context = match.context;
      }
    }
  });
  return [...byKey.values()].map(
    (link): ChatLink => ({
      key: link.key,
      url: link.url,
      label: link.label || shortLinkLabel(link.url),
      context: link.context,
      origin: link.origin,
      firstSeen: link.firstSeen,
      lastSeen: link.lastSeen,
      anchor: link.anchor,
      count: link.count,
    }),
  );
}

/** Produced, then agent, then you; newest first within each; empty sections dropped. */
export function groupChatLinks(links: readonly ChatLink[]): ChatLinkSection[] {
  return SECTION_ORDER.map((origin) => ({
    origin,
    links: links
      .filter((link) => link.origin === origin)
      .sort((left, right) => right.firstSeen.rowIndex - left.firstSeen.rowIndex),
  })).filter((section) => section.links.length > 0);
}
