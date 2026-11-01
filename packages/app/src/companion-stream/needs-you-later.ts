import type { GlobalStreamRow } from "./use-global-stream";
import type { WorkflowView } from "./workflow-view";

/** Divides Needs you from the requests set aside for later, which sit collapsed below it. */
export const LATER_HEADER = { laterHeader: true } as const;
export type FeedItem = GlobalStreamRow | typeof LATER_HEADER;

export const isLaterHeader = (item: FeedItem): item is typeof LATER_HEADER => "laterHeader" in item;

const isDeferredRow = (row: GlobalStreamRow) =>
  row.item.kind === "entry" && Boolean(row.item.entry.deferredAt);

/**
 * Needs you lists what is waiting now; what was set aside follows under a Later header, its rows
 * shown only when expanded. Other views keep deferred rows in place: Later is a triage aid.
 */
export function arrangeLater(
  rows: GlobalStreamRow[],
  view: WorkflowView,
  showLater: boolean,
): { data: FeedItem[]; laterCount: number } {
  if (view !== "needs_you") return { data: rows, laterCount: 0 };
  const later = rows.filter(isDeferredRow);
  if (!later.length) return { data: rows, laterCount: 0 };
  const now = rows.filter((row) => !isDeferredRow(row));
  return { data: [...now, LATER_HEADER, ...(showLater ? later : [])], laterCount: later.length };
}
