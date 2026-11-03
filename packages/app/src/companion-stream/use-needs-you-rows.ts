import { useMemo } from "react";
import { useGlobalStream, type GlobalStreamRow } from "./use-global-stream";
import { NEEDS_YOU_GROUP_ORDER, rowNeedsYouGroup } from "./needs-you-groups";

const NO_TAGS: string[] = [];

export interface NeedsYouRows {
  /** The first `limit` items waiting now: Blocked first, then questions, then permissions. */
  rows: GlobalStreamRow[];
  /** Items waiting now across loaded pages (Later excluded). */
  count: number;
  /** More pages exist or a host is offline/too old, so `count` is a lower bound ("N+"). */
  partial: boolean;
  refetch: () => Promise<unknown>;
}

const groupRank = (row: GlobalStreamRow) => NEEDS_YOU_GROUP_ORDER.indexOf(rowNeedsYouGroup(row));

/**
 * Needs you's Now side, from the same query the Needs you screen issues (all hosts, archived
 * included, no search or tags), so the sidebar section and the screen never disagree.
 */
export function useNeedsYouRows({
  limit,
  enabled,
}: {
  limit: number;
  enabled: boolean;
}): NeedsYouRows {
  const query = useGlobalStream({
    serverId: null,
    view: "needs_you",
    filter: "all",
    search: "",
    tags: NO_TAGS,
    includeArchived: true,
    enabled,
  });
  const now = useMemo(
    () =>
      query.rows
        .filter((row) => row.item.kind !== "entry" || !row.item.entry.deferredAt)
        .map((row, index) => ({ row, index }))
        .sort((a, b) => groupRank(a.row) - groupRank(b.row) || a.index - b.index)
        .map(({ row }) => row),
    [query.rows],
  );
  const rows = useMemo(() => now.slice(0, limit), [now, limit]);
  return {
    rows,
    count: now.length,
    partial: query.hasNextPage || query.notices.length > 0,
    refetch: query.refetch,
  };
}
