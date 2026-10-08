import type { AgentArtifact } from "@getpaseo/protocol/agent-types";
import {
  isCompanionEntryPending,
  companionSourceRole,
  type CompanionEntry,
} from "@getpaseo/protocol/companion-stream";
import type { StreamListOptions, StreamRow } from "@getpaseo/protocol/global-stream";

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

/** A projection of existing records. Never starts a provider or replays a transcript. */
export function listStreamRows(sources: Iterable<StreamSource>, options: StreamListOptions) {
  const search = options.search?.trim().toLocaleLowerCase() ?? "";
  const rows = collectStreamRows(sources, {
    ...options,
    filter: options.filter === "pinned" ? "pinned" : "all",
  });
  const pending = (row: StreamRow) =>
    row.item.kind === "entry" && isCompanionEntryPending(row.item.entry);
  const role = (row: StreamRow) =>
    row.item.kind === "entry" ? companionSourceRole(row.item.entry) : "agent";
  const counts = {
    total: rows.length,
    open: rows.filter(pending).length,
    done: rows.filter((row) => !pending(row)).length,
    user: rows.filter((row) => role(row) === "user").length,
    agent: rows.filter((row) => role(row) === "agent").length,
    unknown: rows.filter((row) => role(row) === "unknown").length,
    matching: 0,
  };
  const rank = (row: StreamRow) =>
    options.asksOnly && row.item.kind === "entry" && row.item.entry.ask?.state === "done" ? 1 : 0;
  const compare = (a: StreamRow, b: StreamRow) => rank(a) - rank(b) || compareStreamRows(a, b);
  const sorted = rows
    .filter(
      (row) =>
        (!options.sourceRole || options.sourceRole === "all" || role(row) === options.sourceRole) &&
        (!(options.state === "open" || options.filter === "pending") || pending(row)) &&
        (options.state !== "done" || !pending(row)),
    )
    .filter(
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
    )
    .sort(compare);
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
    counts: { ...counts, matching: sorted.length },
    nextCursor:
      last && remaining.length > page.length
        ? Buffer.from(
            JSON.stringify(
              options.asksOnly ? [last.timestamp, last.id, rank(last)] : [last.timestamp, last.id],
            ),
          ).toString("base64url")
        : null,
  };
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
    for (const entry of source.companionEntries ?? []) {
      if (!includeEntry(entry, options)) continue;
      if (options.filter === "pending" && !isCompanionEntryPending(entry)) continue;
      if (options.filter === "pinned" && entry.kind !== "pin") continue;
      rows.push({
        ...base,
        id: JSON.stringify([source.id, "entry", entry.id]),
        timestamp: entry.timestamp,
        item: { kind: "entry", entry },
      });
    }
    if (!options.asksOnly && (!options.filter || options.filter === "all")) {
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

function includeEntry(entry: CompanionEntry, options: StreamListOptions): boolean {
  if (entry.source && !options.includeMessageInventory && !entry.ask) return false;
  if (!options.asksOnly || entry.ask) return true;
  return Boolean(options.includeMessageInventory && entry.messageReview?.state === "unreviewed");
}
