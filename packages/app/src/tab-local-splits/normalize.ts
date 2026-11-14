import {
  clampNormalizedSizes,
  collectAllTabs,
  type SplitNode,
  type SplitPane,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-actions";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import { fillChooser, removeLeaf } from "@/tab-local-splits/actions";
import {
  collectLeaves,
  collectMemberTabIds,
  leafIdOf,
  type TabLocalLayout,
  type TabLocalLayouts,
  type TabLocalNode,
} from "@/tab-local-splits/model";

export interface TabLocalMove {
  tabId: string;
  toPaneId: string;
}

export interface TabLocalReorder {
  paneId: string;
  tabIds: string[];
}

export interface TabLocalFocusRedirect {
  paneId: string;
  hostTabId: string;
}

export interface TabLocalNormalizeResult {
  /** The input object when nothing changed. */
  layouts: TabLocalLayouts;
  moves: TabLocalMove[];
  reorders: TabLocalReorder[];
  focusRedirects: TabLocalFocusRedirect[];
}

/** What the chooser asked the launcher for; the next such tab in the host's pane fills it. */
export type TabLocalPendingKind = "draft" | "terminal" | "browser";

export interface TabLocalPendingFill {
  hostTabId: string;
  chooserId: string;
  kind: TabLocalPendingKind;
  knownTabIds: string[];
}

export interface AdoptPendingFillsResult {
  layouts: TabLocalLayouts;
  pending: TabLocalPendingFill[];
}

function collectEveryPane(node: SplitNode): SplitPane[] {
  if (node.kind === "pane") {
    return [node.pane];
  }
  return node.group.children.flatMap(collectEveryPane);
}

function buildPaneIdByTabId(layout: WorkspaceLayout): Map<string, string> {
  const paneIdByTabId = new Map<string, string>();
  for (const pane of collectEveryPane(layout.root)) {
    for (const tabId of pane.tabIds) {
      paneIdByTabId.set(tabId, pane.id);
    }
  }
  return paneIdByTabId;
}

function normalizeNodeSizes(node: TabLocalNode): TabLocalNode {
  if (node.kind !== "group") {
    return node;
  }
  const children = node.children.map(normalizeNodeSizes);
  const sizes = children.map((_, index) => node.sizes[index] ?? 1 / children.length);
  return { ...node, children, sizes: clampNormalizedSizes(sizes) };
}

/**
 * Drops leaves whose tab is gone or already claimed by an earlier composite. Hosts are promoted
 * and one-leaf trees dissolve exactly as `removeLeaf` does for an explicit close.
 */
function pruneLayout(input: {
  layout: TabLocalLayout;
  paneIdByTabId: Map<string, string>;
  claimed: Set<string>;
}): TabLocalLayout | null {
  let current: TabLocalLayout | null = {
    ...input.layout,
    root: normalizeNodeSizes(input.layout.root),
  };
  for (const leaf of collectLeaves(input.layout.root)) {
    if (!current) {
      return null;
    }
    const isStale =
      leaf.kind === "leaf" &&
      (!input.paneIdByTabId.has(leaf.tabId) || input.claimed.has(leaf.tabId));
    if (isStale) {
      current = removeLeaf(current, leafIdOf(leaf));
    }
  }
  if (!current || current.root.kind !== "group") {
    return null;
  }
  return current;
}

function membersByHost(layouts: TabLocalLayouts): Map<string, string[]> {
  return new Map(
    Object.values(layouts).map((layout) => [layout.hostTabId, collectMemberTabIds(layout)]),
  );
}

function planReorders(input: {
  layout: WorkspaceLayout;
  layouts: TabLocalLayouts;
  paneIdByTabId: Map<string, string>;
}): TabLocalReorder[] {
  const members = membersByHost(input.layouts);
  const reorders: TabLocalReorder[] = [];
  for (const pane of collectEveryPane(input.layout.root)) {
    const hosted = [...members.entries()].filter(
      ([hostTabId, memberTabIds]) =>
        input.paneIdByTabId.get(hostTabId) === pane.id &&
        memberTabIds.every((tabId) => input.paneIdByTabId.get(tabId) === pane.id),
    );
    if (hosted.length === 0) {
      continue;
    }
    const hostedMembers = new Set(hosted.flatMap(([, memberTabIds]) => memberTabIds));
    const membersOfHost = new Map(hosted);
    const desired = pane.tabIds.flatMap((tabId) => {
      if (hostedMembers.has(tabId)) {
        return [];
      }
      return [tabId, ...(membersOfHost.get(tabId) ?? [])];
    });
    if (desired.some((tabId, index) => pane.tabIds[index] !== tabId)) {
      reorders.push({ paneId: pane.id, tabIds: desired });
    }
  }
  return reorders;
}

function sameLayouts(left: TabLocalLayouts, right: TabLocalLayouts): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Re-establishes the composite invariants against the current workspace layout, and plans the
 * workspace-layout writes that keep a composite together (spec: invariants 1-4, 6):
 *
 * - every member sits in its host's pane (`moves`), contiguously after the host (`reorders`);
 * - a member that some caller focused (deep link, tab cycling, picker) shows as its host with
 *   that leaf focused (`focusRedirects`);
 * - a tab belongs to at most one composite: the first one keeps it.
 */
export function normalizeTabLocalLayouts(input: {
  layout: WorkspaceLayout;
  layouts: TabLocalLayouts;
  explorerPaneId: string | null;
}): TabLocalNormalizeResult {
  const paneIdByTabId = buildPaneIdByTabId(input.layout);
  const claimed = new Set<string>();
  const next: TabLocalLayouts = {};
  for (const layout of Object.values(input.layouts)) {
    const pruned = pruneLayout({ layout, paneIdByTabId, claimed });
    const hostPaneId = pruned ? paneIdByTabId.get(pruned.hostTabId) : undefined;
    if (!pruned || !hostPaneId || hostPaneId === input.explorerPaneId) {
      continue;
    }
    for (const leaf of collectLeaves(pruned.root)) {
      if (leaf.kind === "leaf") claimed.add(leaf.tabId);
    }
    next[pruned.hostTabId] = pruned;
  }

  const moves: TabLocalMove[] = [];
  for (const layout of Object.values(next)) {
    const hostPaneId = paneIdByTabId.get(layout.hostTabId);
    for (const tabId of collectMemberTabIds(layout)) {
      if (hostPaneId && paneIdByTabId.get(tabId) !== hostPaneId) {
        moves.push({ tabId, toPaneId: hostPaneId });
      }
    }
  }

  const focusRedirects: TabLocalFocusRedirect[] = [];
  const hostByMember = new Map(
    Object.values(next).flatMap((layout) =>
      collectMemberTabIds(layout).map((tabId) => [tabId, layout.hostTabId] as const),
    ),
  );
  for (const pane of collectEveryPane(input.layout.root)) {
    const hostTabId = pane.focusedTabId ? hostByMember.get(pane.focusedTabId) : undefined;
    const host = hostTabId ? next[hostTabId] : undefined;
    if (!pane.focusedTabId || !host || paneIdByTabId.get(host.hostTabId) !== pane.id) {
      continue;
    }
    next[host.hostTabId] = { ...host, focusedLeafId: pane.focusedTabId };
    focusRedirects.push({ paneId: pane.id, hostTabId: host.hostTabId });
  }

  const reorders =
    moves.length > 0 ? [] : planReorders({ layout: input.layout, layouts: next, paneIdByTabId });
  return {
    layouts: sameLayouts(next, input.layouts) ? input.layouts : next,
    moves,
    reorders,
    focusRedirects,
  };
}

/**
 * Tab ids that were replaced in place: same pane, same slot, the old id gone and the new id
 * new. Sending a draft converts `draft_*` to `agent_*` this way, and a member must survive it.
 */
export function detectTabRetargets(
  previous: WorkspaceLayout,
  next: WorkspaceLayout,
): Map<string, string> {
  const previousTabIds = new Set(collectAllTabs(previous.root).map((tab) => tab.tabId));
  const nextTabIds = new Set(collectAllTabs(next.root).map((tab) => tab.tabId));
  const nextPanes = new Map(collectEveryPane(next.root).map((pane) => [pane.id, pane]));
  const retargets = new Map<string, string>();
  for (const pane of collectEveryPane(previous.root)) {
    const nextPane = nextPanes.get(pane.id);
    if (!nextPane || nextPane.tabIds.length !== pane.tabIds.length) {
      continue;
    }
    pane.tabIds.forEach((tabId, index) => {
      const replacement = nextPane.tabIds[index];
      if (
        replacement &&
        replacement !== tabId &&
        !nextTabIds.has(tabId) &&
        !previousTabIds.has(replacement)
      ) {
        retargets.set(tabId, replacement);
      }
    });
  }
  return retargets;
}

function retargetNode(node: TabLocalNode, retargets: Map<string, string>): TabLocalNode {
  if (node.kind === "chooser") {
    return node;
  }
  if (node.kind === "leaf") {
    const tabId = retargets.get(node.tabId);
    return tabId ? { kind: "leaf", tabId } : node;
  }
  return { ...node, children: node.children.map((child) => retargetNode(child, retargets)) };
}

export function retargetTabLocalLayouts(
  layouts: TabLocalLayouts,
  retargets: Map<string, string>,
): TabLocalLayouts {
  if (retargets.size === 0) {
    return layouts;
  }
  const next: TabLocalLayouts = {};
  let changed = false;
  for (const layout of Object.values(layouts)) {
    const hostTabId = retargets.get(layout.hostTabId) ?? layout.hostTabId;
    const focusedLeafId = retargets.get(layout.focusedLeafId) ?? layout.focusedLeafId;
    const root = retargetNode(layout.root, retargets);
    changed ||= root !== layout.root || hostTabId !== layout.hostTabId;
    next[hostTabId] = { hostTabId, root, focusedLeafId };
  }
  return changed ? next : layouts;
}

function matchesPendingKind(target: WorkspaceTabTarget, kind: TabLocalPendingKind): boolean {
  return target.kind === kind;
}

/** Fills each waiting chooser with the first matching tab that appeared in its host's pane. */
export function adoptPendingFills(input: {
  layout: WorkspaceLayout;
  layouts: TabLocalLayouts;
  pending: readonly TabLocalPendingFill[];
}): AdoptPendingFillsResult {
  const tabsById = new Map(collectAllTabs(input.layout.root).map((tab) => [tab.tabId, tab]));
  const panes = collectEveryPane(input.layout.root);
  let layouts = input.layouts;
  const remaining: TabLocalPendingFill[] = [];
  for (const fill of input.pending) {
    const composite = layouts[fill.hostTabId];
    const chooserOpen =
      composite !== undefined &&
      collectLeaves(composite.root).some((leaf) => leafIdOf(leaf) === fill.chooserId);
    if (!chooserOpen) {
      continue;
    }
    const hostPane = panes.find((pane) => pane.tabIds.includes(fill.hostTabId));
    const known = new Set(fill.knownTabIds);
    const adopted = hostPane?.tabIds.find((tabId) => {
      const tab = tabsById.get(tabId);
      return !known.has(tabId) && tab !== undefined && matchesPendingKind(tab.target, fill.kind);
    });
    if (!adopted) {
      remaining.push(fill);
      continue;
    }
    layouts = fillChooser({
      layouts,
      hostTabId: fill.hostTabId,
      chooserId: fill.chooserId,
      tabId: adopted,
    });
  }
  return { layouts, pending: remaining };
}
