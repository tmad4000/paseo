import type { WorkspaceTabDescriptor } from "./workspace-tabs-types";

export interface TabActivityState {
  lastActivityAt: number;
  /** Activity this strip saw land while the tab was off screen and not yet read. */
  activityUnread: boolean;
  /** What the dot shows: unread activity, or host attention the reader has not cleared. */
  unread: boolean;
}

export interface TabReadPolicy {
  /** Legacy: a tab on screen is read. Off: only an explicit mark (or a sent prompt) reads it. */
  viewingMarksRead: boolean;
  /** Activity timestamp each agent was explicitly read through, keyed by agent id. */
  readThroughByAgentId: ReadonlyMap<string, number>;
  /**
   * Agents holding clearable (finished/error) host attention. The host persists it and clears it
   * only on a read, so it carries unread across reloads, devices and strips that were not mounted.
   */
  attentionAgentIds: ReadonlySet<string>;
}

const LEGACY_TAB_READ_POLICY: TabReadPolicy = {
  viewingMarksRead: true,
  readThroughByAgentId: new Map(),
  attentionAgentIds: new Set(),
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
    const agentId = tab.target.agentId;
    const timestamp = activityByAgentId.get(agentId) ?? 0;
    const before = previous.get(tab.tabId);
    const viewed = viewedTabIds.has(tab.tabId);
    const lastActivityAt = Math.max(timestamp, before?.lastActivityAt ?? 0);
    // Activity that lands while the tab is on screen was seen, so it never raises the dot.
    const movedOnUnseen = Boolean(
      before && !viewed && before.lastActivityAt > 0 && timestamp > before.lastActivityAt,
    );
    const readThrough = policy.readThroughByAgentId.get(agentId) ?? 0;
    const explicitlyRead = readThrough > 0 && readThrough >= lastActivityAt;
    const readByViewing = viewed && policy.viewingMarksRead;
    const activityUnread =
      !readByViewing && !explicitlyRead && (Boolean(before?.activityUnread) || movedOnUnseen);
    next.set(tab.tabId, {
      lastActivityAt,
      activityUnread,
      unread: activityUnread || (!readByViewing && policy.attentionAgentIds.has(agentId)),
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
