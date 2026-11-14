/**
 * A composite tab is a group of ordinary workspace tabs plus a tree over their tab ids. The tabs
 * stay in the pane's `tabIds`, so every walker over the workspace layout (reconcile, timeline
 * sync, sidebar counts, deep links, `ui open-tab`) keeps seeing them; only the strip hides the
 * members. See docs/fork-features.md (`tab-local-splits`).
 */
export type TabLocalDirection = "horizontal" | "vertical";

export type TabLocalSplitSide = "right" | "below";

export interface TabLocalTabLeaf {
  kind: "leaf";
  tabId: string;
}

/** A leaf that has not been given content yet. Nothing runs until the user picks. */
export interface TabLocalChooserLeaf {
  kind: "chooser";
  id: string;
}

export interface TabLocalGroup {
  kind: "group";
  id: string;
  direction: TabLocalDirection;
  children: TabLocalNode[];
  sizes: number[];
}

export type TabLocalLeaf = TabLocalTabLeaf | TabLocalChooserLeaf;

export type TabLocalNode = TabLocalLeaf | TabLocalGroup;

export interface TabLocalLayout {
  /** The tab shown in the strip. It is also a leaf of `root`. */
  hostTabId: string;
  root: TabLocalNode;
  /** A tab id, or a chooser id. */
  focusedLeafId: string;
}

/** One workspace's composites, keyed by host tab id. */
export type TabLocalLayouts = Record<string, TabLocalLayout>;

export const TAB_LOCAL_MAX_DEPTH = 3;
export const TAB_LOCAL_LEAF_MIN_WIDTH = 160;
export const TAB_LOCAL_LEAF_MIN_HEIGHT = 120;

const CHOOSER_ID_PREFIX = "chooser:";

export function buildChooserId(suffix: string): string {
  return `${CHOOSER_ID_PREFIX}${suffix}`;
}

export function isChooserId(leafId: string): boolean {
  return leafId.startsWith(CHOOSER_ID_PREFIX);
}

export function leafIdOf(leaf: TabLocalLeaf): string {
  return leaf.kind === "leaf" ? leaf.tabId : leaf.id;
}

/** Leaves in document order (left-to-right, top-to-bottom). */
export function collectLeaves(node: TabLocalNode): TabLocalLeaf[] {
  if (node.kind !== "group") {
    return [node];
  }
  return node.children.flatMap(collectLeaves);
}

export function collectLeafTabIds(layout: TabLocalLayout): string[] {
  return collectLeaves(layout.root).flatMap((leaf) => (leaf.kind === "leaf" ? [leaf.tabId] : []));
}

export function collectMemberTabIds(layout: TabLocalLayout): string[] {
  return collectLeafTabIds(layout).filter((tabId) => tabId !== layout.hostTabId);
}

export function countLeaves(layout: TabLocalLayout): number {
  return collectLeaves(layout.root).length;
}

/** The composite a tab belongs to, as host or member. */
export function findLayoutContainingTab(
  layouts: TabLocalLayouts,
  tabId: string,
): TabLocalLayout | null {
  for (const layout of Object.values(layouts)) {
    if (collectLeafTabIds(layout).includes(tabId)) {
      return layout;
    }
  }
  return null;
}

/** Member tab id -> host tab id, for every composite of the workspace. */
export function buildHostByMemberTabId(layouts: TabLocalLayouts): Map<string, string> {
  const hostByMember = new Map<string, string>();
  for (const layout of Object.values(layouts)) {
    for (const tabId of collectMemberTabIds(layout)) {
      hostByMember.set(tabId, layout.hostTabId);
    }
  }
  return hostByMember;
}

/** Number of groups above the leaf; a leaf at the root has depth 0. */
export function getLeafDepth(node: TabLocalNode, leafId: string): number | null {
  if (node.kind !== "group") {
    return leafIdOf(node) === leafId ? 0 : null;
  }
  for (const child of node.children) {
    const depth = getLeafDepth(child, leafId);
    if (depth !== null) {
      return depth + 1;
    }
  }
  return null;
}

/** The direction a composite reads as in the strip: its top-level split. */
export function getTopLevelDirection(layout: TabLocalLayout): TabLocalDirection {
  return layout.root.kind === "group" ? layout.root.direction : "horizontal";
}
