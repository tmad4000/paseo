import type { WorkspaceTabDescriptor } from "./workspace-tabs-types";

/**
 * How far along a tab is from "something happened" to "dealt with":
 * - `new`: activity (or host attention) this device has not even looked at. Filled badge.
 * - `seen`: the tab sat on screen after that activity, but nobody marked it read. Hollow ring.
 * - `read`: explicitly read (check, menu, sent prompt), or nothing to read. No badge.
 */
export type TabReadState = "new" | "seen" | "read";

/** The unread tabs of a strip and which level each is at. `.has(tabId)` means "unread". */
export type UnreadTabStates = ReadonlyMap<string, Exclude<TabReadState, "read">>;

export function collectUnreadTabStates(
  activity: ReadonlyMap<string, TabActivityState>,
): UnreadTabStates {
  const unread = new Map<string, Exclude<TabReadState, "read">>();
  for (const [tabId, state] of activity) {
    if (state.readState !== "read") unread.set(tabId, state.readState);
  }
  return unread;
}

/** How long a tab must stay on screen to count as seen, so Ctrl+Tab flick-through does not. */
export const TAB_SEEN_DWELL_MS = 1500;

export interface TabActivityState {
  lastActivityAt: number;
  /** Activity this strip saw land while the tab was off screen and not yet read. */
  activityUnread: boolean;
  /** What the dot shows: unread activity, or host attention the reader has not cleared. */
  unread: boolean;
  /** `unread` split by whether this device has looked at it yet. `read` exactly when !unread. */
  readState: TabReadState;
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
  /**
   * The seen clock (see `agentSeenClock`) each agent was seen through on this device. Optional so
   * callers that never show the seen level can leave it out.
   */
  seenThroughByAgentId?: ReadonlyMap<string, number>;
  /** Attention timestamps of the agents in `attentionAgentIds`, part of the seen clock. */
  attentionAtByAgentId?: ReadonlyMap<string, number>;
}

const LEGACY_TAB_READ_POLICY: TabReadPolicy = {
  viewingMarksRead: true,
  readThroughByAgentId: new Map(),
  attentionAgentIds: new Set(),
};

/**
 * What "seen through" is measured against: the later of the agent's last activity and its host
 * attention stamp. A turn finishing, or a "Mark as unread" from any device, moves it forward and
 * so turns a seen ring back into a filled badge.
 */
export function agentSeenClock(activityAt: number, attentionAt: number | undefined): number {
  return Math.max(activityAt, attentionAt ?? 0);
}

function deriveTabReadState(input: {
  unread: boolean;
  tabId: string;
  agentId: string;
  lastActivityAt: number;
  policy: TabReadPolicy;
  dwelledTabIds: ReadonlySet<string>;
}): TabReadState {
  const { unread, tabId, agentId, lastActivityAt, policy, dwelledTabIds } = input;
  if (!unread) return "read";
  // Legacy mode reads on view, so the seen level never shows there.
  if (policy.viewingMarksRead) return "new";
  if (dwelledTabIds.has(tabId)) return "seen";
  const seenThrough = policy.seenThroughByAgentId?.get(agentId) ?? 0;
  const clock = agentSeenClock(lastActivityAt, policy.attentionAtByAgentId?.get(agentId));
  return seenThrough > 0 && seenThrough >= clock ? "seen" : "new";
}

export function reconcileTabActivity(
  previous: Map<string, TabActivityState>,
  tabs: WorkspaceTabDescriptor[],
  activityByAgentId: Map<string, number>,
  viewedTabIds: Set<string>,
  policy: TabReadPolicy = LEGACY_TAB_READ_POLICY,
  /**
   * Tabs on screen right now for at least `TAB_SEEN_DWELL_MS`. They are seen through whatever
   * they show, so a turn finishing in front of the reader lands as a ring without a filled flash
   * before this device's seen mark catches up.
   */
  dwelledTabIds: ReadonlySet<string> = new Set(),
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
    const unread = activityUnread || (!readByViewing && policy.attentionAgentIds.has(agentId));
    next.set(tab.tabId, {
      lastActivityAt,
      activityUnread,
      unread,
      readState: deriveTabReadState({
        unread,
        tabId: tab.tabId,
        agentId,
        lastActivityAt,
        policy,
        dwelledTabIds,
      }),
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
