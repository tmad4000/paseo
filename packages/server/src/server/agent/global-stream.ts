import type { AgentArtifact } from "@getpaseo/protocol/agent-types";
import {
  isCompanionEntryPending,
  isUserQuestionEntry,
  needsUserInput,
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
  serverId?: string,
): StreamPage {
  if (Boolean(options.relatedAgentId) !== Boolean(options.relatedServerId))
    throw new Error("Related session requires both host and agent identity");
  const search = options.search?.trim().toLocaleLowerCase() ?? "";
  const tags = normalizeStreamTags(options.tags ?? []);
  const orderTasks = options.asksOnly || options.view === "tasks";
  const rank = (row: StreamRow) =>
    orderTasks && row.item.kind === "entry" && row.item.entry.ask?.state === "done" ? 1 : 0;
  const compare = (a: StreamRow, b: StreamRow) => rank(a) - rank(b) || compareStreamRows(a, b);
  const scoped = collectStreamRows(sources, options, serverId).filter(
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
  const after = decodeStreamCursor(options.cursor);
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
              orderTasks ? [last.timestamp, last.id, rank(last)] : [last.timestamp, last.id],
            ),
          ).toString("base64url")
        : null,
    tagCounts,
  };
}

function decodeStreamCursor(
  cursor?: string,
): { timestamp: string; id: string; rank: number } | undefined {
  if (!cursor) return undefined;
  const decoded: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString());
  if (
    !Array.isArray(decoded) ||
    (decoded.length !== 2 && decoded.length !== 3) ||
    typeof decoded[0] !== "string" ||
    typeof decoded[1] !== "string" ||
    (decoded.length === 3 && decoded[2] !== 0 && decoded[2] !== 1)
  )
    throw new Error("Invalid Stream cursor");
  return { timestamp: decoded[0], id: decoded[1], rank: decoded[2] === 1 ? 1 : 0 };
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
  if (options.view === "tasks" && (!entry.ask || entry.ask.canonicalTask)) return false;
  if (options.view === "questions" && !isUserQuestionEntry(entry)) return false;
  if (options.view === "needs_you" && !needsUserInput(entry)) return false;
  if (options.view === "saved" && entry.kind !== "pin") return false;
  if (options.asksOnly && !entry.ask) return false;
  if (options.userQuestionsOnly && !isUserQuestionEntry(entry)) return false;
  if (options.filter === "pending" && !isCompanionEntryPending(entry)) return false;
  return options.filter !== "pinned" || entry.kind === "pin";
}

type TaskSessionIndex = ReadonlyMap<string, NonNullable<CompanionEntry["ask"]>["sessions"]>;
type RowSource = Pick<StreamRow, "agentId" | "agentTitle" | "cwd" | "workspaceId" | "archived">;

function indexTaskSessions(sources: readonly StreamSource[], serverId?: string): TaskSessionIndex {
  const index = new Map<string, NonNullable<CompanionEntry["ask"]>["sessions"]>();
  for (const source of sources) {
    if (source.internal) continue;
    for (const entry of source.companionEntries ?? []) {
      if (entry.ask && !entry.ask.canonicalTask)
        index.set(JSON.stringify([serverId, source.id, entry.id]), entry.ask.sessions);
    }
  }
  return index;
}

function collectStreamRows(
  sources: Iterable<StreamSource>,
  options: StreamListOptions,
  serverId?: string,
): StreamRow[] {
  const rows: StreamRow[] = [];
  const allSources = [...sources];
  const taskSessions = indexTaskSessions(allSources, serverId);
  for (const source of allSources) {
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
      if (!isCanonicalWorkflowRow(entry, source, options, serverId)) continue;
      if (!matchesRelatedSession(source, entry, options, serverId, taskSessions)) continue;
      rows.push(projectEntryRow(base, entry, serverId));
    }
    if (includeSourceArtifacts(source, options, serverId)) {
      for (const artifact of source.artifacts ?? [])
        rows.push({
          ...base,
          id: JSON.stringify([source.id, "artifact", artifact.path]),
          timestamp: artifact.updatedAt,
          item: { kind: "artifact", artifact },
        });
    }
  }
  return rows;
}

function projectEntryRow(base: RowSource, entry: CompanionEntry, serverId?: string): StreamRow {
  const taskId = entry.ask
    ? (entry.ask.taskId ?? JSON.stringify([serverId, base.agentId, entry.id]))
    : undefined;
  return {
    ...base,
    id: JSON.stringify([base.agentId, "entry", entry.id]),
    timestamp: entry.timestamp,
    taskId,
    item: { kind: "entry", entry },
  };
}

function isCanonicalWorkflowRow(
  entry: CompanionEntry,
  source: StreamSource,
  options: StreamListOptions,
  serverId?: string,
): boolean {
  const origin = entry.ask?.origin;
  if (!options.view || options.view === "activity" || !origin) return true;
  return (
    origin.serverId === serverId && origin.agentId === source.id && origin.entryId === entry.id
  );
}

function includeSourceArtifacts(
  source: StreamSource,
  options: StreamListOptions,
  serverId?: string,
): boolean {
  if (options.asksOnly || options.userQuestionsOnly) return false;
  if (options.view && options.view !== "activity" && options.view !== "saved") return false;
  if (options.filter && options.filter !== "all") return false;
  return (
    !options.relatedAgentId ||
    (source.id === options.relatedAgentId && serverId === options.relatedServerId)
  );
}

export function compareStreamRows(
  a: Pick<StreamRow, "timestamp" | "id">,
  b: Pick<StreamRow, "timestamp" | "id">,
): number {
  return b.timestamp.localeCompare(a.timestamp) || a.id.localeCompare(b.id);
}

function isHiddenSource(source: StreamSource, options: StreamListOptions): boolean {
  const includeArchived = options.includeArchived ?? Boolean(options.view);
  return Boolean(source.internal || (source.archivedAt && !includeArchived));
}

/** Session is a projection of origin + explicit execution links, never a second task container. */
function matchesRelatedSession(
  source: StreamSource,
  entry: CompanionEntry,
  options: StreamListOptions,
  serverId: string | undefined,
  taskSessions: ReadonlyMap<string, NonNullable<CompanionEntry["ask"]>["sessions"]>,
): boolean {
  if (!options.relatedAgentId) return true;
  if (!options.relatedServerId) throw new Error("Related session must include its host");
  if (source.id === options.relatedAgentId && serverId === options.relatedServerId) return true;
  const task = entry.inputRequest?.task;
  const linkedSessions = task
    ? taskSessions.get(JSON.stringify([task.serverId, task.agentId, task.entryId]))
    : undefined;
  const sessions = entry.ask?.sessions ?? linkedSessions;
  return (
    sessions?.some(
      (session) =>
        session.agentId === options.relatedAgentId && session.serverId === options.relatedServerId,
    ) ?? false
  );
}
