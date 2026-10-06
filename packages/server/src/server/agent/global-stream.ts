import type { AgentArtifact } from "@getpaseo/protocol/agent-types";
import { isCompanionEntryPending, type CompanionEntry } from "@getpaseo/protocol/companion-stream";
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
  const rows = collectStreamRows(sources, options);
  const sorted = rows
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
    .sort(compareStreamRows);
  let after: { timestamp: string; id: string } | undefined;
  if (options.cursor) {
    const decoded: unknown = JSON.parse(Buffer.from(options.cursor, "base64url").toString());
    if (
      !Array.isArray(decoded) ||
      decoded.length !== 2 ||
      decoded.some((v) => typeof v !== "string")
    ) {
      throw new Error("Invalid Stream cursor");
    }
    after = { timestamp: decoded[0], id: decoded[1] };
  }
  const remaining = after ? sorted.filter((row) => compareStreamRows(row, after!) > 0) : sorted;
  const page = remaining.slice(0, options.limit ?? 50);
  const last = page.at(-1);
  return {
    rows: page,
    nextCursor:
      last && remaining.length > page.length
        ? Buffer.from(JSON.stringify([last.timestamp, last.id])).toString("base64url")
        : null,
  };
}

function collectStreamRows(
  sources: Iterable<StreamSource>,
  options: StreamListOptions,
): StreamRow[] {
  const rows: StreamRow[] = [];
  for (const source of sources) {
    if (source.internal || (source.archivedAt && !options.includeArchived)) continue;
    const base = {
      agentId: source.id,
      agentTitle: source.title || source.id,
      cwd: source.cwd,
      workspaceId: source.workspaceId,
      archived: Boolean(source.archivedAt),
    };
    for (const entry of source.companionEntries ?? []) {
      if (options.filter === "pending" && !isCompanionEntryPending(entry)) continue;
      if (options.filter === "pinned" && entry.kind !== "pin") continue;
      rows.push({
        ...base,
        id: JSON.stringify([source.id, "entry", entry.id]),
        timestamp: entry.timestamp,
        item: { kind: "entry", entry },
      });
    }
    if (!options.filter || options.filter === "all") {
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
