import type { GlobalStreamRow } from "./use-global-stream";

/** Exact canonical identity only. Similar text, names and delegated worker IDs never merge work. */
export function deduplicateTasks(rows: readonly GlobalStreamRow[]): GlobalStreamRow[] {
  const unique = new Map<string, GlobalStreamRow>();
  for (const row of rows) {
    const entry = row.item.kind === "entry" ? row.item.entry : undefined;
    const task = entry?.ask;
    const origin = task?.origin;
    // Only dedupe shared identities whose origin is explicit. Legacy origins remain host-qualified.
    const key =
      task?.taskId && origin
        ? JSON.stringify(["task", task.taskId, origin.serverId, origin.agentId, origin.entryId])
        : JSON.stringify([row.serverId, row.id]);
    const previous = unique.get(key);
    if (!previous || isOrigin(row) || (!isOrigin(previous) && revision(row) > revision(previous)))
      unique.set(key, row);
  }
  return [...unique.values()];
}

function isOrigin(row: GlobalStreamRow): boolean {
  if (row.item.kind !== "entry") return false;
  const origin = row.item.entry.ask?.origin;
  return Boolean(
    origin &&
    origin.serverId === row.serverId &&
    origin.agentId === row.agentId &&
    origin.entryId === row.item.entry.id,
  );
}

function revision(row: GlobalStreamRow): number {
  return row.item.kind === "entry" ? (row.item.entry.ask?.revision ?? 0) : 0;
}
