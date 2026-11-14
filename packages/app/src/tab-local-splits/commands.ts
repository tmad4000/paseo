import { defaultWorkspaceLayoutIds } from "@/stores/workspace-layout-ids";
import {
  collectAllTabs,
  findPaneContainingTab,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import {
  compositeKey,
  selectWorkspaceTabLocalLayouts,
  useTabLocalSplitsStore,
} from "@/stores/tab-local-splits-store";
import {
  breakOutLeaf,
  cancelChooser,
  fillChooser,
  focusLeaf,
  resizeTabLocalGroup,
  splitTabLocal,
  type TabLocalLeafSize,
  type TabLocalSplitRefusal,
} from "@/tab-local-splits/actions";
import { computeTabLocalFrames } from "@/tab-local-splits/geometry";
import {
  collectMemberTabIds,
  type TabLocalLayout,
  type TabLocalLayouts,
  type TabLocalSplitSide,
} from "@/tab-local-splits/model";
import type { TabLocalPendingKind } from "@/tab-local-splits/normalize";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

/** Tabs that cannot own or join a tab-local split. */
export function canHostTabLocalSplit(target: WorkspaceTabTarget): boolean {
  return target.kind !== "new_tab" && target.kind !== "setup";
}

function readLayouts(workspaceKey: string): TabLocalLayouts {
  return selectWorkspaceTabLocalLayouts(useTabLocalSplitsStore.getState(), workspaceKey);
}

function writeLayouts(workspaceKey: string, layouts: TabLocalLayouts): void {
  useTabLocalSplitsStore.getState().setLayouts(workspaceKey, layouts);
}

function createId(): string {
  return defaultWorkspaceLayoutIds.createNodeId("group");
}

function focusedLeafSize(workspaceKey: string, layout: TabLocalLayout): TabLocalLeafSize | null {
  const size =
    useTabLocalSplitsStore.getState().sizeByComposite[compositeKey(workspaceKey, layout.hostTabId)];
  const frame = computeTabLocalFrames(layout.root).leaves.find(
    (leaf) => leaf.leafId === layout.focusedLeafId,
  );
  if (!size || !frame) {
    return null;
  }
  return { width: size.width * frame.rect.width, height: size.height * frame.rect.height };
}

export type TabLocalSplitCommandResult =
  | { kind: "split" }
  | { kind: "refused"; reason: TabLocalSplitRefusal };

/** "Split this tab": the tab becomes (or stays) a composite with a chooser beside its focused leaf. */
export function splitThisTab(input: {
  workspaceKey: string;
  tabId: string;
  side: TabLocalSplitSide;
}): TabLocalSplitCommandResult {
  const layouts = readLayouts(input.workspaceKey);
  const existing = layouts[input.tabId];
  const result = splitTabLocal({
    layouts,
    hostTabId: input.tabId,
    side: input.side,
    createId,
    leafSize: existing ? focusedLeafSize(input.workspaceKey, existing) : null,
  });
  if (result.kind === "refused") {
    return result;
  }
  useTabLocalSplitsStore.getState().setZoomedLeaf(input.workspaceKey, input.tabId, null);
  writeLayouts(input.workspaceKey, result.layouts);
  useWorkspaceLayoutStore.getState().focusTab(input.workspaceKey, input.tabId);
  return { kind: "split" };
}

export function chooseExistingTab(input: {
  workspaceKey: string;
  hostTabId: string;
  chooserId: string;
  tabId: string;
}): void {
  writeLayouts(
    input.workspaceKey,
    fillChooser({
      layouts: readLayouts(input.workspaceKey),
      hostTabId: input.hostTabId,
      chooserId: input.chooserId,
      tabId: input.tabId,
    }),
  );
}

/** The launcher creates the tab; the sync adopts the first new tab of this kind into the chooser. */
export function awaitNewTab(input: {
  workspaceKey: string;
  hostTabId: string;
  chooserId: string;
  kind: TabLocalPendingKind;
}): void {
  const layout = useWorkspaceLayoutStore.getState().layoutByWorkspace[input.workspaceKey];
  const knownTabIds = layout ? collectAllTabs(layout.root).map((tab) => tab.tabId) : [];
  const store = useTabLocalSplitsStore.getState();
  const others = (store.pendingFillsByWorkspace[input.workspaceKey] ?? []).filter(
    (fill) => fill.chooserId !== input.chooserId,
  );
  store.setPendingFills(input.workspaceKey, [
    ...others,
    {
      hostTabId: input.hostTabId,
      chooserId: input.chooserId,
      kind: input.kind,
      knownTabIds,
    },
  ]);
}

export function dismissChooser(input: {
  workspaceKey: string;
  hostTabId: string;
  chooserId: string;
}): void {
  const store = useTabLocalSplitsStore.getState();
  store.setPendingFills(
    input.workspaceKey,
    (store.pendingFillsByWorkspace[input.workspaceKey] ?? []).filter(
      (fill) => fill.chooserId !== input.chooserId,
    ),
  );
  writeLayouts(
    input.workspaceKey,
    cancelChooser({ layouts: readLayouts(input.workspaceKey), ...input }),
  );
}

export function focusTabLocalLeaf(input: {
  workspaceKey: string;
  hostTabId: string;
  leafId: string;
}): void {
  writeLayouts(
    input.workspaceKey,
    focusLeaf({ layouts: readLayouts(input.workspaceKey), ...input }),
  );
}

export function resizeTabLocalSplit(input: {
  workspaceKey: string;
  hostTabId: string;
  groupId: string;
  sizes: number[];
}): void {
  writeLayouts(
    input.workspaceKey,
    resizeTabLocalGroup({ layouts: readLayouts(input.workspaceKey), ...input }),
  );
}

export function toggleTabLocalZoom(input: { workspaceKey: string; hostTabId: string }): void {
  const layout = readLayouts(input.workspaceKey)[input.hostTabId];
  if (!layout) {
    return;
  }
  const store = useTabLocalSplitsStore.getState();
  const zoomed = store.zoomedLeafByComposite[compositeKey(input.workspaceKey, input.hostTabId)];
  store.setZoomedLeaf(
    input.workspaceKey,
    input.hostTabId,
    zoomed === layout.focusedLeafId ? null : layout.focusedLeafId,
  );
}

function collectMemberSet(layouts: TabLocalLayouts): Set<string> {
  return new Set(Object.values(layouts).flatMap((composite) => collectMemberTabIds(composite)));
}

/** "Move to its own tab": the process is untouched; the tab reappears right of its composite. */
export function moveLeafToOwnTab(input: {
  workspaceKey: string;
  hostTabId: string;
  tabId: string;
}): void {
  const workspaceLayoutStore = useWorkspaceLayoutStore.getState();
  const layout = workspaceLayoutStore.layoutByWorkspace[input.workspaceKey];
  const pane = layout ? findPaneContainingTab(layout.root, input.hostTabId) : null;
  if (!pane) {
    return;
  }
  const layouts = readLayouts(input.workspaceKey);
  const hiddenBefore = collectMemberSet(layouts);
  const stripTabIds = pane.tabIds.filter((tabId) => !hiddenBefore.has(tabId));
  const { layouts: next, insertionIndex } = breakOutLeaf({
    layouts,
    hostTabId: input.hostTabId,
    leafId: input.tabId,
    stripTabIds,
  });
  writeLayouts(input.workspaceKey, next);

  // The tab that just became visible is the one broken out, or the member promoted to host.
  const hiddenAfter = collectMemberSet(next);
  const revealed = [...hiddenBefore].find((tabId) => !hiddenAfter.has(tabId));
  const visible = [...stripTabIds];
  if (revealed) {
    visible.splice(insertionIndex, 0, revealed);
  }
  const ordered = visible.flatMap((tabId) =>
    [tabId].concat(next[tabId] ? collectMemberTabIds(next[tabId]) : []),
  );
  const rest = pane.tabIds.filter((tabId) => !ordered.includes(tabId));
  workspaceLayoutStore.reorderTabsInPane(input.workspaceKey, pane.id, [...ordered, ...rest]);
  workspaceLayoutStore.focusTab(input.workspaceKey, input.tabId);
}
