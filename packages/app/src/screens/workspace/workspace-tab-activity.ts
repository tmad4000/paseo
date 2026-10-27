import type { WorkspaceTabDescriptor } from "./workspace-tabs-types";

export interface TabActivityState {
  lastActivityAt: number;
  unread: boolean;
}

export interface TabReadPolicy {
  /** Legacy: a tab on screen is read. Off: only an explicit mark (or a sent prompt) reads it. */
  viewingMarksRead: boolean;
  /** Activity timestamp each agent was explicitly read through, keyed by agent id. */
  readThroughByAgentId: ReadonlyMap<string, number>;
}

const LEGACY_TAB_READ_POLICY: TabReadPolicy = {
  viewingMarksRead: true,
  readThroughByAgentId: new Map(),
};

export function reconcileTabActivity(
  previous: Map<string, TabActivityState>,
  tabs: WorkspaceTabDescriptor[],
  activityByAgentId: Map<string, number>,
  viewedTabIds: Set<string>,
  policy: TabReadPolicy = LEGACY_TAB_READ_POLICY,
): Map<string, TabActivityState> {
  const next = new Map<string, TabActivityState>();
  for (const tab of tabs) {
    if (tab.target.kind !== "agent") continue;
    const timestamp = activityByAgentId.get(tab.target.agentId) ?? 0;
    const before = previous.get(tab.tabId);
    const viewed = viewedTabIds.has(tab.tabId);
    const lastActivityAt = Math.max(timestamp, before?.lastActivityAt ?? 0);
    // Activity that lands while the tab is on screen was seen, so it never raises the dot.
    const movedOnUnseen = Boolean(
      before && !viewed && before.lastActivityAt > 0 && timestamp > before.lastActivityAt,
    );
    const readThrough = policy.readThroughByAgentId.get(tab.target.agentId) ?? 0;
    const explicitlyRead = readThrough > 0 && readThrough >= lastActivityAt;
    const readByViewing = viewed && policy.viewingMarksRead;
    next.set(tab.tabId, {
      lastActivityAt,
      unread: !readByViewing && !explicitlyRead && (Boolean(before?.unread) || movedOnUnseen),
    });
  }
  return next;
}

export function sortTabsByActivity<T extends { tab: WorkspaceTabDescriptor }>(
  items: T[],
  activityByAgentId: Map<string, number>,
): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const timestamp = (entry: T) =>
        entry.tab.target.kind === "agent"
          ? (activityByAgentId.get(entry.tab.target.agentId) ?? 0)
          : 0;
      return timestamp(right.item) - timestamp(left.item) || left.index - right.index;
    })
    .map(({ item }) => item);
}
