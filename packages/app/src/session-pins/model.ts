// Stored through the existing agent-label API; scoped to the owning daemon's agent record.
export const SESSION_PIN_LABEL = "paseo.session-pinned-at";

export interface PinnableSession {
  serverId: string;
  id: string;
  title: string | null;
  labels: Record<string, string>;
  archivedAt?: unknown;
}

export function sessionPinnedAt(session: Pick<PinnableSession, "labels">): number | null {
  const value = session.labels[SESSION_PIN_LABEL];
  const timestamp = value ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function sessionPinKey(session: Pick<PinnableSession, "serverId" | "id">): string {
  return JSON.stringify([session.serverId, session.id]);
}

export function selectPinnedSessions<T extends PinnableSession>(sessions: Iterable<T>): T[] {
  const unique = new Map<string, T>();
  for (const session of sessions) {
    if (!session.archivedAt && sessionPinnedAt(session) !== null) {
      unique.set(sessionPinKey(session), session);
    }
  }
  return [...unique.values()].sort(
    (a, b) =>
      sessionPinnedAt(b)! - sessionPinnedAt(a)! || sessionPinKey(a).localeCompare(sessionPinKey(b)),
  );
}

export async function setSessionPinned(
  session: PinnableSession,
  pinned: boolean,
  update: (agentId: string, updates: { labels: Record<string, string> }) => Promise<void>,
  now: () => Date = () => new Date(),
): Promise<void> {
  if (pinned && session.archivedAt) throw new Error("Archived sessions cannot be pinned");
  if ((sessionPinnedAt(session) !== null) === pinned) return;
  await update(session.id, {
    labels: { [SESSION_PIN_LABEL]: pinned ? now().toISOString() : "" },
  });
}
