import type { AgentLifecycleStatus } from "@getpaseo/protocol/agent-lifecycle";
import type { AgentProvider } from "@getpaseo/protocol/agent-types";
import { recentSessionKey, type RecentSession } from "./recent-workspaces";

/** What the Recent menu and Cmd+K need to know about one agent, read from the session store. */
export interface RecentSessionAgentInfo {
  title: string | null;
  provider: AgentProvider;
  status: AgentLifecycleStatus;
  requiresAttention: boolean;
  attentionReason: "finished" | "error" | "permission" | null;
  pendingPermissionCount: number;
  archived: boolean;
}

export interface RecentSessionRow extends RecentSession {
  key: string;
  title: string | null;
  provider: AgentProvider;
  status: AgentLifecycleStatus;
  requiresAttention: boolean;
  attentionReason: "finished" | "error" | "permission" | null;
  pendingPermissionCount: number;
  /** "Project · Workspace", for muted text under the title. */
  breadcrumb: string;
}

export const RECENT_SESSIONS_MENU_LIMIT = 10;

/**
 * Recent sessions that can still be opened, most recently focused first. Sessions
 * whose host has not reported them (offline, or deleted) and archived ones are
 * skipped rather than forgotten. The session you are looking at is left out: it is
 * not somewhere to go.
 */
export function buildRecentSessionRows(input: {
  sessions: readonly RecentSession[];
  current: { serverId: string; agentId: string } | null;
  agentInfo: (serverId: string, agentId: string) => RecentSessionAgentInfo | null;
  breadcrumb: (serverId: string, workspaceId: string) => string;
  limit?: number;
}): RecentSessionRow[] {
  const rows: RecentSessionRow[] = [];
  const currentKey = input.current ? recentSessionKey(input.current) : null;
  for (const session of input.sessions) {
    if (input.limit !== undefined && rows.length >= input.limit) break;
    const key = recentSessionKey(session);
    if (key === currentKey) continue;
    const info = input.agentInfo(session.serverId, session.agentId);
    if (!info || info.archived) continue;
    rows.push({
      ...session,
      key,
      title: info.title,
      provider: info.provider,
      status: info.status,
      requiresAttention: info.requiresAttention,
      attentionReason: info.attentionReason,
      pendingPermissionCount: info.pendingPermissionCount,
      breadcrumb: input.breadcrumb(session.serverId, session.workspaceId),
    });
  }
  return rows;
}

/**
 * Keep only rows for recent sessions, most recently focused first, without the one
 * on screen. For lists that already have their own row type (Cmd+K's agent rows).
 */
export function orderRowsByRecentSessions<Row>(input: {
  rows: readonly Row[];
  sessionKeyOf: (row: Row) => string;
  sessions: readonly RecentSession[];
  currentKey: string | null;
}): Row[] {
  const rank = new Map(input.sessions.map((session, index) => [recentSessionKey(session), index]));
  return input.rows
    .flatMap((row) => {
      const key = input.sessionKeyOf(row);
      const index = rank.get(key);
      return index === undefined || key === input.currentKey ? [] : [{ row, index }];
    })
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.row);
}
