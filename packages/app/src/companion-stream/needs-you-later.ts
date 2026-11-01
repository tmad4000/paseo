import type { GlobalStreamRow } from "./use-global-stream";
import type { WorkflowView } from "./workflow-view";

const isDeferredRow = (row: GlobalStreamRow) =>
  row.item.kind === "entry" && Boolean(row.item.entry.deferredAt);

/**
 * Needs you shows either what is waiting now or what was set aside for later, switched from the
 * header so Later stays one tap away however long the list is. With nothing left in Later it
 * falls back to Now. Other views keep deferred rows in place: Later is a triage aid.
 */
export function splitLater(
  rows: GlobalStreamRow[],
  view: WorkflowView,
  showLater: boolean,
): { data: GlobalStreamRow[]; nowCount: number; laterCount: number; showingLater: boolean } {
  if (view !== "needs_you") return { data: rows, nowCount: 0, laterCount: 0, showingLater: false };
  const later = rows.filter(isDeferredRow);
  const now = rows.filter((row) => !isDeferredRow(row));
  const showingLater = showLater && later.length > 0;
  return {
    data: showingLater ? later : now,
    nowCount: now.length,
    laterCount: later.length,
    showingLater,
  };
}
