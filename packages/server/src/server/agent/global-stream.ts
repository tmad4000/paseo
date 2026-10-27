import type { AgentArtifact } from "@getpaseo/protocol/agent-types";
import {
  isCompanionEntryPending,
  isUserQuestionEntry,
  type CompanionEntry,
} from "@getpaseo/protocol/companion-stream";
import type {
  StreamListOptions,
  StreamRow,
  StreamTagCount,
} from "@getpaseo/protocol/global-stream";
import { normalizeStreamTags, streamEntryTags } from "@getpaseo/protocol/stream-tags";

const TAG_COUNT_LIMIT = 200;

export interface StreamSource {
  id: string;
  title?: string | null;
  cwd: string;
  workspaceId?: string;
  archivedAt?: string | null;
  internal?: boolean;
  companionEntries?: CompanionEntry[];
  artifacts?: AgentArtifact[];
}

export interface StreamPage {
  rows: StreamRow[];
  nextCursor: string | null;
  tagCounts: StreamTagCount[];
}

/** A projection of existing records. Never starts a provider or replays a transcript. */
export function listStreamRows(
  sources: Iterable<StreamSource>,
  options: StreamListOptions,
): StreamPage {
  const search = options.search?.trim().toLocaleLowerCase() ?? "";
  const tags = normalizeStreamTags(options.tags ?? []);
  const rank = (row: StreamRow) =>
    options.asksOnly && row.item.kind === "entry" && row.item.entry.ask?.state === "done" ? 1 : 0;
  const compare = (a: StreamRow, b: StreamRow) => rank(a) - rank(b) || compareStreamRows(a, b);
  const scoped = collectStreamRows(sources, options).filter(
    (row) =>
      !search ||
      [
        row.agentTitle,
        row.cwd,
        row.item.kind === "entry" ? row.item.entry.text : row.item.artifact.path,
      ]
        .join("\n")
        .toLocaleLowerCase()
        .includes(search),
  );
  // Counts ignore the tag filter itself so the cloud stays put while tags are toggled.
  const tagCounts = countStreamTags(scoped);
  const sorted = scoped.filter((row) => matchesTags(row, tags)).sort(compare);
  let after: { timestamp: string; id: string; rank: number } | undefined;
  if (options.cursor) {
    const decoded: unknown = JSON.parse(Buffer.from(options.cursor, "base64url").toString());
    if (
      !Array.isArray(decoded) ||
      (decoded.length !== 2 && decoded.length !== 3) ||
      typeof decoded[0] !== "string" ||
      typeof decoded[1] !== "string" ||
      (decoded.length === 3 && decoded[2] !== 0 && decoded[2] !== 1)
    ) {
      throw new Error("Invalid Stream cursor");
    }
    after = { timestamp: decoded[0], id: decoded[1], rank: decoded[2] === 1 ? 1 : 0 };
  }
  const remaining = after
    ? sorted.filter((row) => (rank(row) - after!.rank || compareStreamRows(row, after!)) > 0)
    : sorted;
  const page = remaining.slice(0, options.limit ?? 50);
  const last = page.at(-1);
  return {
    rows: page,
    nextCursor:
      last && remaining.length > page.length
        ? Buffer.from(
            JSON.stringify(
              options.asksOnly ? [last.timestamp, last.id, rank(last)] : [last.timestamp, last.id],
            ),
          ).toString("base64url")
        : null,
    tagCounts,
  };
}

function matchesTags(row: StreamRow, tags: readonly string[]): boolean {
  if (!tags.length) return true;
  if (row.item.kind !== "entry") return false;
  const entryTags = row.item.entry.tags ?? [];
  return tags.every((tag) => entryTags.includes(tag));
}

export function countStreamTags(rows: readonly StreamRow[]): StreamTagCount[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.item.kind !== "entry") continue;
    for (const tag of row.item.entry.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, TAG_COUNT_LIMIT);
}

/** Entries written before tags existed get them parsed on read; stored entries are not rewritten. */
function withTags(entry: CompanionEntry): CompanionEntry {
  if (entry.tags) return entry;
  const tags = streamEntryTags(entry);
  return tags.length ? { ...entry, tags } : entry;
}

function matchesEntryFilters(entry: CompanionEntry, options: StreamListOptions): boolean {
  if (options.asksOnly && !entry.ask) return false;
  if (options.userQuestionsOnly && !isUserQuestionEntry(entry)) return false;
  if (options.filter === "pending" && !isCompanionEntryPending(entry)) return false;
  return options.filter !== "pinned" || entry.kind === "pin";
}

function collectStreamRows(
  sources: Iterable<StreamSource>,
  options: StreamListOptions,
): StreamRow[] {
  const rows: StreamRow[] = [];
  for (const source of sources) {
    if (options.agentId && source.id !== options.agentId) continue;
    if (isHiddenSource(source, options)) continue;
    const base = {
      agentId: source.id,
      agentTitle: source.title || source.id,
      cwd: source.cwd,
      workspaceId: source.workspaceId,
      archived: Boolean(source.archivedAt),
    };
    for (const stored of source.companionEntries ?? []) {
      const entry = withTags(stored);
      if (!matchesEntryFilters(entry, options)) continue;
      rows.push({
        ...base,
        id: JSON.stringify([source.id, "entry", entry.id]),
        timestamp: entry.timestamp,
        item: { kind: "entry", entry },
      });
    }
    const entriesOnly = options.asksOnly || options.userQuestionsOnly;
    if (!entriesOnly && (!options.filter || options.filter === "all")) {
      for (const artifact of source.artifacts ?? []) {
        rows.push({
          ...base,
          id: JSON.stringify([source.id, "artifact", artifact.path]),
          timestamp: artifact.updatedAt,
          item: { kind: "artifact", artifact },
        });
      }
    }
  }
  return rows;
}

export function compareStreamRows(
  a: Pick<StreamRow, "timestamp" | "id">,
  b: Pick<StreamRow, "timestamp" | "id">,
): number {
  return b.timestamp.localeCompare(a.timestamp) || a.id.localeCompare(b.id);
}

function isHiddenSource(source: StreamSource, options: StreamListOptions): boolean {
  return Boolean(source.internal || (source.archivedAt && !options.includeArchived));
}
