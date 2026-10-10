export interface RecentWorkspace {
  serverId: string;
  workspaceId: string;
  visitedAt: number;
}

export interface RecentWorkspaceKeyInput {
  serverId: string;
  workspaceId: string;
}

export interface RecentWorkspaceEntry extends RecentWorkspace {
  key: string;
  title: string;
  subtitle: string;
  isCurrent: boolean;
}

export interface RecentWorkspaceLabels {
  title: string;
  subtitle: string;
}

/**
 * One focus visit: a workspace, and the agent session focused in it when there was
 * one. Sessions and workspaces share this single most-recent-first list; workspace
 * recency is derived from it, so the Ctrl+Tab switcher, Cmd+K and the Recent menu
 * cannot disagree.
 */
export interface RecentVisit extends RecentWorkspace {
  agentId: string | null;
}

export interface RecentSession extends RecentWorkspace {
  agentId: string;
}

export const MAX_RECENT_VISITS = 60;

export function recentWorkspaceKey(input: RecentWorkspaceKeyInput): string {
  return `${input.serverId}:${input.workspaceId}`;
}

export function recentSessionKey(input: { serverId: string; agentId: string }): string {
  return `${input.serverId}:${input.agentId}`;
}

function sameWorkspace(left: RecentWorkspaceKeyInput, right: RecentWorkspaceKeyInput): boolean {
  return left.serverId === right.serverId && left.workspaceId === right.workspaceId;
}

function sameVisit(left: RecentVisit, right: RecentVisit): boolean {
  return sameWorkspace(left, right) && left.agentId === right.agentId;
}

/**
 * Move a visit to the front. Re-visiting the front entry is a no-op, so focus churn
 * does not rewrite storage. A session visit replaces its workspace's session-less
 * entry: the workspace's recency is carried by the session from then on.
 */
export function touchRecentVisit(
  visits: readonly RecentVisit[],
  next: RecentVisit,
  maxLength = MAX_RECENT_VISITS,
): readonly RecentVisit[] {
  const front = visits[0];
  if (front && sameVisit(front, next)) {
    return visits;
  }
  const rest = visits.filter(
    (entry) =>
      !sameVisit(entry, next) &&
      !(next.agentId !== null && entry.agentId === null && sameWorkspace(entry, next)),
  );
  return [next, ...rest].slice(0, maxLength);
}

/** Workspaces in the order any of their visits were last made. */
export function recentWorkspacesFromVisits(visits: readonly RecentVisit[]): RecentWorkspace[] {
  const seen = new Set<string>();
  const workspaces: RecentWorkspace[] = [];
  for (const visit of visits) {
    const key = recentWorkspaceKey(visit);
    if (seen.has(key)) continue;
    seen.add(key);
    workspaces.push({
      serverId: visit.serverId,
      workspaceId: visit.workspaceId,
      visitedAt: visit.visitedAt,
    });
  }
  return workspaces;
}

/** Agent sessions, most recently focused first. */
export function recentSessionsFromVisits(visits: readonly RecentVisit[]): RecentSession[] {
  const seen = new Set<string>();
  const sessions: RecentSession[] = [];
  for (const visit of visits) {
    if (visit.agentId === null) continue;
    const key = recentSessionKey({ serverId: visit.serverId, agentId: visit.agentId });
    if (seen.has(key)) continue;
    seen.add(key);
    sessions.push({ ...visit, agentId: visit.agentId });
  }
  return sessions;
}

/**
 * Recent workspaces that still exist, most recent first, with labels. `labelsOf`
 * returns null for a workspace that is gone or being archived; those are skipped
 * rather than forgotten, since a host may simply not have reconnected yet.
 */
export function buildRecentWorkspaceEntries(input: {
  recent: readonly RecentWorkspace[];
  current: RecentWorkspaceKeyInput | null;
  labelsOf: (workspace: RecentWorkspaceKeyInput) => RecentWorkspaceLabels | null;
}): RecentWorkspaceEntry[] {
  const entries: RecentWorkspaceEntry[] = [];
  for (const workspace of input.recent) {
    const labels = input.labelsOf(workspace);
    if (!labels) {
      continue;
    }
    entries.push({
      ...workspace,
      key: recentWorkspaceKey(workspace),
      title: labels.title,
      subtitle: labels.subtitle,
      isCurrent: input.current !== null && sameWorkspace(workspace, input.current),
    });
  }
  return entries;
}

/**
 * Where a switcher starts. From inside a workspace, the first press means "the one
 * before this", as Cmd+Tab does; from a settings page it means the latest one.
 */
export function initialRecentWorkspaceIndex(
  entries: readonly RecentWorkspaceEntry[],
  direction: 1 | -1,
): number | null {
  const index =
    direction === 1
      ? entries.findIndex((entry) => !entry.isCurrent)
      : entries.findLastIndex((entry) => !entry.isCurrent);
  return index === -1 ? null : index;
}

export function stepRecentWorkspaceIndex(index: number, delta: 1 | -1, length: number): number {
  if (length === 0) {
    return 0;
  }
  return (index + delta + length) % length;
}

/**
 * Orders workspace keys for a picker: most recently visited first, the current
 * workspace after the other visited ones (it is where you already are), then
 * everything never visited, left in a stable tie for the caller to break.
 */
export function createRecentWorkspaceComparator(
  recent: readonly RecentWorkspace[],
  currentKey: string | null,
): (leftKey: string, rightKey: string) => number {
  const ranks = new Map(recent.map((entry, index) => [recentWorkspaceKey(entry), index]));
  const unvisited = recent.length + 1;
  const rankOf = (key: string) => {
    const rank = ranks.get(key);
    if (rank === undefined) return unvisited;
    return key === currentKey ? recent.length : rank;
  };
  return (leftKey, rightKey) => rankOf(leftKey) - rankOf(rightKey);
}
