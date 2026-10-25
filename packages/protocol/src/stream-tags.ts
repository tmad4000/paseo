import type { CompanionEntry } from "./companion-stream.js";

/** Tags are lowercase letters, digits, `_` and `-`, starting with a letter. */
export const STREAM_TAG_MAX_LENGTH = 50;
export const STREAM_TAGS_PER_ENTRY = 20;
export const STREAM_PINNED_TAGS_MAX = 50;

const TAG_BODY = String.raw`\p{L}[\p{L}\p{N}_-]*`;
const TAG_PATTERN = new RegExp(`^${TAG_BODY}$`, "u");
// A hashtag starts a word: not after a letter, digit, `_`, `#`, `&` (HTML entity) or `/`.
const HASHTAG_PATTERN = new RegExp(`(^|[^\\p{L}\\p{N}_#&/])#(${TAG_BODY})`, "gu");
const FENCED_CODE = /```[\s\S]*?(?:```|$)/g;
const INLINE_CODE = /`[^`\n]*`/g;
const URL = /\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S+/gi;

/** Lowercase a user-typed tag (with or without `#`); null when it is not a valid tag. */
export function normalizeStreamTag(input: string): string | null {
  const tag = input
    .trim()
    .replace(/^#+/, "")
    .replace(/[-_]+$/, "")
    .toLowerCase();
  if (!tag || tag.length > STREAM_TAG_MAX_LENGTH || !TAG_PATTERN.test(tag)) return null;
  return tag;
}

export function normalizeStreamTags(inputs: readonly string[]): string[] {
  const tags: string[] = [];
  for (const input of inputs) {
    const tag = normalizeStreamTag(input);
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

/** Inline #hashtags in order of first appearance, ignoring code spans and URLs. */
export function parseStreamHashtags(text: string): string[] {
  const prose = text.replace(FENCED_CODE, " ").replace(INLINE_CODE, " ").replace(URL, " ");
  const tags: string[] = [];
  for (const match of prose.matchAll(HASHTAG_PATTERN)) {
    const tag = normalizeStreamTag(match[2]);
    if (tag && !tags.includes(tag)) tags.push(tag);
    if (tags.length >= STREAM_TAGS_PER_ENTRY) break;
  }
  return tags;
}

export interface StreamTextSegment {
  text: string;
  /** Set when this segment is a hashtag (including its `#`). */
  tag?: string;
}

/** Split text into plain and hashtag segments using the same rules as the parser. */
export function segmentStreamHashtags(text: string): StreamTextSegment[] {
  const blocked: Array<[number, number]> = [];
  for (const pattern of [FENCED_CODE, INLINE_CODE, URL]) {
    for (const match of text.matchAll(pattern))
      blocked.push([match.index, match.index + match[0].length]);
  }
  const segments: StreamTextSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(HASHTAG_PATTERN)) {
    const start = match.index + match[1].length;
    const end = start + 1 + match[2].length;
    if (blocked.some(([from, to]) => start < to && end > from)) continue;
    const tag = normalizeStreamTag(match[2]);
    if (!tag) continue;
    if (start > cursor) segments.push({ text: text.slice(cursor, start) });
    segments.push({ text: text.slice(start, end), tag });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  return segments;
}

/**
 * User- or agent-authored notes carry tags: pins, Stream questions, tracked asks and Q&A.
 * Inferred questions, permissions and turn outcomes quote provider output and are never tagged.
 */
export function isTaggableStreamEntry(entry: CompanionEntry): boolean {
  if (entry.kind === "pin" || entry.kind === "q_and_a") return true;
  return (
    entry.kind === "question" && (entry.id.startsWith("question:") || entry.id.startsWith("ask:"))
  );
}

/** Tags stored on the entry, or parsed from its text for entries written before tags existed. */
export function streamEntryTags(entry: CompanionEntry): string[] {
  if (entry.tags) return entry.tags;
  return isTaggableStreamEntry(entry) ? parseStreamHashtags(entry.text) : [];
}

/** Append tags the text does not already contain, as ` #tag` words. */
export function appendStreamTags(text: string, tags: readonly string[]): string {
  const present = new Set(parseStreamHashtags(text));
  const missing = normalizeStreamTags(tags).filter((tag) => !present.has(tag));
  if (!missing.length) return text;
  const suffix = missing.map((tag) => `#${tag}`).join(" ");
  return text.trimEnd() ? `${text.trimEnd()}\n\n${suffix}` : suffix;
}
