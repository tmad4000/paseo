import { workspaceLabelKey } from "@getpaseo/protocol/workspace-labels";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { SIDEBAR_UNLABELLED_LABEL_KEY, type SidebarLabelFilter } from "@/stores/sidebar-view-store";
import type { StatusBucket, StatusGroup } from "@/hooks/sidebar-status-view-model";

export interface SidebarWorkspaceGroup {
  key: string;
  label: string;
  rows: SidebarWorkspaceEntry[];
  /**
   * What heads the group. `none` is the one-list mode's single group: no header row, nothing to
   * collapse, just the rows — each of which already carries its own status badge.
   */
  leading: { kind: "status"; bucket: StatusBucket } | { kind: "none" };
}

/** The key of one-list mode's only group. */
export const SIDEBAR_ONE_LIST_GROUP_KEY = "list";

/**
 * One-list mode: every unpinned workspace in a single headerless group, in the order it arrives.
 * The sidebar model hands the projection its entries already filtered and sorted by the chosen
 * sort mode, so this keeps that order rather than imposing one of its own.
 */
export function oneListWorkspaceGroups(
  rows: readonly SidebarWorkspaceEntry[],
): SidebarWorkspaceGroup[] {
  if (rows.length === 0) return [];
  return [
    { key: SIDEBAR_ONE_LIST_GROUP_KEY, label: "", rows: [...rows], leading: { kind: "none" } },
  ];
}

export function statusWorkspaceGroups(groups: readonly StatusGroup[]): SidebarWorkspaceGroup[] {
  return groups.map((group) => ({
    key: group.bucket,
    label: group.label,
    rows: group.rows,
    leading: { kind: "status", bucket: group.bucket },
  }));
}

/**
 * Applies the Labels page's selection to the sidebar.
 *
 * `Unlabelled` is a row like any other, so it is a key in the same list rather than a boolean
 * beside it; the only thing that makes it special is what the key asks of a workspace.
 * Selecting several labels includes workspaces carrying any of them.
 */
export function filterWorkspacesByLabels(
  input: { workspaces: readonly SidebarWorkspaceEntry[] } & SidebarLabelFilter,
): SidebarWorkspaceEntry[] {
  const { workspaces, labels } = input;
  if (labels.length === 0) return [...workspaces];
  return workspaces.filter((workspace) => {
    // Whitespace-only names normalize away, so `size === 0` is exactly "carries no real label"
    // and the empty key can only ever mean Unlabelled.
    const keys = new Set((workspace.labels ?? []).map(workspaceLabelKey).filter(Boolean));
    const matches = (key: string) =>
      key === SIDEBAR_UNLABELLED_LABEL_KEY ? keys.size === 0 : keys.has(key);
    return labels.some(matches);
  });
}
