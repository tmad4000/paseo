import type { SplitNode } from "@/stores/workspace-layout-actions";
import { findAdjacentPane } from "@/utils/split-navigation";
import { leafIdOf, type TabLocalDirection, type TabLocalNode } from "@/tab-local-splits/model";

/** Fractions of the composite's box, 0..1. */
export interface TabLocalRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface TabLocalLeafFrame {
  leafId: string;
  rect: TabLocalRect;
}

export interface TabLocalDividerFrame {
  groupId: string;
  direction: TabLocalDirection;
  /** The divider sits after child `index`. */
  index: number;
  sizes: number[];
  /** The group's own box, which the resize handle measures its drag against. */
  groupRect: TabLocalRect;
  /** Position along the split axis, as a fraction of the composite. */
  offset: number;
}

export interface TabLocalFrames {
  leaves: TabLocalLeafFrame[];
  dividers: TabLocalDividerFrame[];
}

const FULL_RECT: TabLocalRect = { left: 0, top: 0, width: 1, height: 1 };

function childRect(
  rect: TabLocalRect,
  direction: TabLocalDirection,
  start: number,
  size: number,
): TabLocalRect {
  if (direction === "horizontal") {
    return { ...rect, left: rect.left + rect.width * start, width: rect.width * size };
  }
  return { ...rect, top: rect.top + rect.height * start, height: rect.height * size };
}

function collectFrames(node: TabLocalNode, rect: TabLocalRect, frames: TabLocalFrames): void {
  if (node.kind !== "group") {
    frames.leaves.push({ leafId: leafIdOf(node), rect });
    return;
  }
  let start = 0;
  node.children.forEach((child, index) => {
    const size = node.sizes[index] ?? 0;
    collectFrames(child, childRect(rect, node.direction, start, size), frames);
    start += size;
    if (index < node.children.length - 1) {
      frames.dividers.push({
        groupId: node.id,
        direction: node.direction,
        index,
        sizes: node.sizes,
        groupRect: rect,
        offset:
          node.direction === "horizontal"
            ? rect.left + rect.width * start
            : rect.top + rect.height * start,
      });
    }
  });
}

/**
 * Every leaf's box and every divider, flat. Leaves render as siblings positioned from these
 * frames, so restructuring the tree never re-parents (and so never remounts) a leaf's content.
 */
export function computeTabLocalFrames(root: TabLocalNode): TabLocalFrames {
  const frames: TabLocalFrames = { leaves: [], dividers: [] };
  collectFrames(root, FULL_RECT, frames);
  return frames;
}

function toSplitNode(node: TabLocalNode): SplitNode {
  if (node.kind !== "group") {
    return { kind: "pane", pane: { id: leafIdOf(node), tabIds: [], focusedTabId: null } };
  }
  return {
    kind: "group",
    group: {
      id: node.id,
      direction: node.direction,
      children: node.children.map(toSplitNode),
      sizes: node.sizes,
    },
  };
}

/** The spatial neighbour, by the same geometry upstream uses to move focus between panes. */
export function findAdjacentLeaf(
  root: TabLocalNode,
  leafId: string,
  direction: "left" | "right" | "up" | "down",
): string | null {
  return findAdjacentPane(toSplitNode(root), leafId, direction);
}
