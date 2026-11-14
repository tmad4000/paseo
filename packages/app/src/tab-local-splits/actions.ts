import { clampNormalizedSizes } from "@/stores/workspace-layout-actions";
import {
  TAB_LOCAL_LEAF_MIN_HEIGHT,
  TAB_LOCAL_LEAF_MIN_WIDTH,
  TAB_LOCAL_MAX_DEPTH,
  buildChooserId,
  collectLeaves,
  findLayoutContainingTab,
  getLeafDepth,
  leafIdOf,
  type TabLocalChooserLeaf,
  type TabLocalDirection,
  type TabLocalLayout,
  type TabLocalLayouts,
  type TabLocalNode,
  type TabLocalSplitSide,
  type TabLocalTabLeaf,
} from "@/tab-local-splits/model";

export type TabLocalSplitRefusal = "max-depth" | "min-size";

export interface TabLocalLeafSize {
  width: number;
  height: number;
}

export interface SplitTabLocalInput {
  layouts: TabLocalLayouts;
  /** The tab shown in the strip: a plain tab, or the host of an existing composite. */
  hostTabId: string;
  side: TabLocalSplitSide;
  createId: () => string;
  /** Measured size of the leaf being split, when it is on screen. */
  leafSize?: TabLocalLeafSize | null;
}

export type SplitTabLocalResult =
  | { kind: "split"; layouts: TabLocalLayouts; chooserId: string }
  | { kind: "refused"; reason: TabLocalSplitRefusal };

export interface BreakOutLeafResult {
  layouts: TabLocalLayouts;
  /** Where the tab now sits in the visible strip: directly right of the composite. */
  insertionIndex: number;
}

function directionForSide(side: TabLocalSplitSide): TabLocalDirection {
  return side === "right" ? "horizontal" : "vertical";
}

function withLayout(layouts: TabLocalLayouts, layout: TabLocalLayout): TabLocalLayouts {
  return { ...layouts, [layout.hostTabId]: layout };
}

function withoutLayout(layouts: TabLocalLayouts, hostTabId: string): TabLocalLayouts {
  const { [hostTabId]: _removed, ...rest } = layouts;
  return rest;
}

function containsLeaf(node: TabLocalNode, leafId: string): boolean {
  return collectLeaves(node).some((leaf) => leafIdOf(leaf) === leafId);
}

function splitNode(input: {
  node: TabLocalNode;
  leafId: string;
  direction: TabLocalDirection;
  chooser: TabLocalChooserLeaf;
  createId: () => string;
}): TabLocalNode {
  const { node, leafId, direction, chooser, createId } = input;
  if (node.kind !== "group") {
    return {
      kind: "group",
      id: createId(),
      direction,
      children: [node, chooser],
      sizes: [0.5, 0.5],
    };
  }
  const index = node.children.findIndex((child) => containsLeaf(child, leafId));
  const child = node.children[index];
  if (!child) {
    return node;
  }
  const isSplitLeafHere = child.kind !== "group" && node.direction === direction;
  if (isSplitLeafHere) {
    // Same orientation as the parent: take half of the leaf's share instead of nesting.
    const half = (node.sizes[index] ?? 1 / node.children.length) / 2;
    const children = [...node.children];
    children.splice(index + 1, 0, chooser);
    const sizes = [...node.sizes];
    sizes.splice(index, 1, half, half);
    return { ...node, children, sizes };
  }
  const children = [...node.children];
  children[index] = splitNode({ node: child, leafId, direction, chooser, createId });
  return { ...node, children };
}

function removeLeafFromNode(node: TabLocalNode, leafId: string): TabLocalNode | null {
  if (node.kind !== "group") {
    return leafIdOf(node) === leafId ? null : node;
  }
  const kept: { child: TabLocalNode; size: number }[] = [];
  node.children.forEach((child, index) => {
    const next = removeLeafFromNode(child, leafId);
    if (next) {
      kept.push({ child: next, size: node.sizes[index] ?? 1 / node.children.length });
    }
  });
  if (kept.length === 0) {
    return null;
  }
  const [onlyChild] = kept;
  if (kept.length === 1 && onlyChild) {
    return onlyChild.child;
  }
  return {
    ...node,
    children: kept.map((entry) => entry.child),
    sizes: clampNormalizedSizes(kept.map((entry) => entry.size)),
  };
}

function replaceLeafInNode(node: TabLocalNode, leafId: string, next: TabLocalNode): TabLocalNode {
  if (node.kind !== "group") {
    return leafIdOf(node) === leafId ? next : node;
  }
  return {
    ...node,
    children: node.children.map((child) => replaceLeafInNode(child, leafId, next)),
  };
}

function updateGroupSizes(node: TabLocalNode, groupId: string, sizes: number[]): TabLocalNode {
  if (node.kind !== "group") {
    return node;
  }
  if (node.id === groupId && sizes.length === node.children.length) {
    return { ...node, sizes: clampNormalizedSizes(sizes) };
  }
  return {
    ...node,
    children: node.children.map((child) => updateGroupSizes(child, groupId, sizes)),
  };
}

/**
 * Removes one leaf. Single-child groups collapse, a tree left with one leaf dissolves (`null`),
 * and when the host goes the first remaining tab leaf in document order becomes the host.
 */
export function removeLeaf(layout: TabLocalLayout, leafId: string): TabLocalLayout | null {
  const root = removeLeafFromNode(layout.root, leafId);
  if (!root || root.kind !== "group") {
    return null;
  }
  const firstTabLeaf = collectLeaves(root).find(
    (leaf): leaf is TabLocalTabLeaf => leaf.kind === "leaf",
  );
  const hostTabId = leafId === layout.hostTabId ? firstTabLeaf?.tabId : layout.hostTabId;
  if (!hostTabId) {
    return null;
  }
  const focusedLeafId =
    layout.focusedLeafId === leafId || !containsLeaf(root, layout.focusedLeafId)
      ? hostTabId
      : layout.focusedLeafId;
  return { hostTabId, root, focusedLeafId };
}

function replaceComposite(
  layouts: TabLocalLayouts,
  previousHostTabId: string,
  next: TabLocalLayout | null,
): TabLocalLayouts {
  const rest = withoutLayout(layouts, previousHostTabId);
  return next ? withLayout(rest, next) : rest;
}

/** Takes a tab out of whichever composite holds it, as host or member. */
export function removeTabFromLayouts(layouts: TabLocalLayouts, tabId: string): TabLocalLayouts {
  const owner = findLayoutContainingTab(layouts, tabId);
  if (!owner) {
    return layouts;
  }
  return replaceComposite(layouts, owner.hostTabId, removeLeaf(owner, tabId));
}

function resolveSplitTarget(
  layouts: TabLocalLayouts,
  hostTabId: string,
): { layout: TabLocalLayout; leafId: string } {
  const existing = layouts[hostTabId];
  if (existing) {
    return { layout: existing, leafId: existing.focusedLeafId };
  }
  return {
    layout: { hostTabId, root: { kind: "leaf", tabId: hostTabId }, focusedLeafId: hostTabId },
    leafId: hostTabId,
  };
}

function isTooSmallToHalve(size: TabLocalLeafSize, side: TabLocalSplitSide): boolean {
  if (side === "right") {
    return size.width / 2 < TAB_LOCAL_LEAF_MIN_WIDTH || size.height < TAB_LOCAL_LEAF_MIN_HEIGHT;
  }
  return size.height / 2 < TAB_LOCAL_LEAF_MIN_HEIGHT || size.width < TAB_LOCAL_LEAF_MIN_WIDTH;
}

/**
 * Opens a chooser beside the focused leaf (the tab itself when it is not yet a composite),
 * taking half of that leaf. Nothing is created: the chooser decides what fills it.
 */
export function splitTabLocal(input: SplitTabLocalInput): SplitTabLocalResult {
  if (input.leafSize && isTooSmallToHalve(input.leafSize, input.side)) {
    return { kind: "refused", reason: "min-size" };
  }
  const { layout, leafId } = resolveSplitTarget(input.layouts, input.hostTabId);
  const chooser: TabLocalChooserLeaf = { kind: "chooser", id: buildChooserId(input.createId()) };
  const root = splitNode({
    node: layout.root,
    leafId,
    direction: directionForSide(input.side),
    chooser,
    createId: input.createId,
  });
  if ((getLeafDepth(root, chooser.id) ?? 0) > TAB_LOCAL_MAX_DEPTH) {
    return { kind: "refused", reason: "max-depth" };
  }
  return {
    kind: "split",
    layouts: withLayout(input.layouts, { ...layout, root, focusedLeafId: chooser.id }),
    chooserId: chooser.id,
  };
}

/**
 * Puts a tab into a chooser leaf. A tab that already belongs to another composite moves: it
 * leaves that group first, so no tab is ever shown twice.
 */
export function fillChooser(input: {
  layouts: TabLocalLayouts;
  hostTabId: string;
  chooserId: string;
  tabId: string;
}): TabLocalLayouts {
  const target = input.layouts[input.hostTabId];
  if (!target || !containsLeaf(target.root, input.chooserId)) {
    return input.layouts;
  }
  if (containsLeaf(target.root, input.tabId)) {
    return input.layouts;
  }
  const detached = removeTabFromLayouts(input.layouts, input.tabId);
  const host = detached[input.hostTabId];
  if (!host) {
    return detached;
  }
  return withLayout(detached, {
    ...host,
    root: replaceLeafInNode(host.root, input.chooserId, { kind: "leaf", tabId: input.tabId }),
    focusedLeafId: input.tabId,
  });
}

export function cancelChooser(input: {
  layouts: TabLocalLayouts;
  hostTabId: string;
  chooserId: string;
}): TabLocalLayouts {
  return closeLeaf({ layouts: input.layouts, hostTabId: input.hostTabId, leafId: input.chooserId });
}

export function closeLeaf(input: {
  layouts: TabLocalLayouts;
  hostTabId: string;
  leafId: string;
}): TabLocalLayouts {
  const layout = input.layouts[input.hostTabId];
  if (!layout || !containsLeaf(layout.root, input.leafId)) {
    return input.layouts;
  }
  return replaceComposite(input.layouts, input.hostTabId, removeLeaf(layout, input.leafId));
}

/** "Move to its own tab": the tab leaves the group and the strip shows it right of the host. */
export function breakOutLeaf(input: {
  layouts: TabLocalLayouts;
  hostTabId: string;
  leafId: string;
  /** Tab ids in visible strip order. */
  stripTabIds: readonly string[];
}): BreakOutLeafResult {
  return {
    layouts: closeLeaf(input),
    insertionIndex: input.stripTabIds.indexOf(input.hostTabId) + 1,
  };
}

export function focusLeaf(input: {
  layouts: TabLocalLayouts;
  hostTabId: string;
  leafId: string;
}): TabLocalLayouts {
  const layout = input.layouts[input.hostTabId];
  if (
    !layout ||
    layout.focusedLeafId === input.leafId ||
    !containsLeaf(layout.root, input.leafId)
  ) {
    return input.layouts;
  }
  return withLayout(input.layouts, { ...layout, focusedLeafId: input.leafId });
}

export function resizeTabLocalGroup(input: {
  layouts: TabLocalLayouts;
  hostTabId: string;
  groupId: string;
  sizes: number[];
}): TabLocalLayouts {
  const layout = input.layouts[input.hostTabId];
  if (!layout) {
    return input.layouts;
  }
  return withLayout(input.layouts, {
    ...layout,
    root: updateGroupSizes(layout.root, input.groupId, input.sizes),
  });
}
