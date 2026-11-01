import type { GlobalStreamRow } from "./use-global-stream";
import type { WorkflowView } from "./workflow-view";

const isDeferredRow = (row: GlobalStreamRow) =>
  row.item.kind === "entry" && Boolean(row.item.entry.deferredAt);

/**
 * Needs you shows either what is waiting now or what was set aside for later, switched from a
 * bar that stays put above the list. The chosen side stays chosen even when it empties.
 * Other views keep deferred rows in place: Later is a triage aid.
 */
export function splitLater(
  rows: GlobalStreamRow[],
  view: WorkflowView,
  showLater: boolean,
): { data: GlobalStreamRow[]; nowCount: number; laterCount: number } {
  if (view !== "needs_you") return { data: rows, nowCount: 0, laterCount: 0 };
  const later = rows.filter(isDeferredRow);
  const now = rows.filter((row) => !isDeferredRow(row));
  return { data: showLater ? later : now, nowCount: now.length, laterCount: later.length };
}
