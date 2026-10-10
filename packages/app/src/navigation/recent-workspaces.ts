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

export const MAX_RECENT_WORKSPACES = 30;

export function recentWorkspaceKey(input: RecentWorkspaceKeyInput): string {
  return `${input.serverId}:${input.workspaceId}`;
}

function sameWorkspace(left: RecentWorkspaceKeyInput, right: RecentWorkspaceKeyInput): boolean {
  return left.serverId === right.serverId && left.workspaceId === right.workspaceId;
}

/** Move a workspace to the front. Re-visiting the front entry is a no-op, so focus churn inside one workspace does not rewrite storage. */
export function touchRecentWorkspace(
  recent: readonly RecentWorkspace[],
  next: RecentWorkspace,
  maxLength = MAX_RECENT_WORKSPACES,
): readonly RecentWorkspace[] {
  const front = recent[0];
  if (front && sameWorkspace(front, next)) {
    return recent;
  }
  return [next, ...recent.filter((entry) => !sameWorkspace(entry, next))].slice(0, maxLength);
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
