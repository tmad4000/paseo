import { getReviewStatus, shouldAutoOpenAgentTab } from "@getpaseo/protocol/agent-labels";
import { deriveAgentStateBucket } from "@getpaseo/protocol/agent-state-bucket";
import type { Agent } from "@/stores/session-store";
import { isWorkspaceRootAgent } from "@/subagents/policies";

export type ReviewAgent = Pick<
  Agent,
  | "id"
  | "workspaceId"
  | "parentAgentId"
  | "archivedAt"
  | "labels"
  | "status"
  | "turn"
  | "pendingPermissions"
  | "requiresAttention"
  | "attentionReason"
  | "messageActivity"
> &
  Partial<Pick<Agent, "attentionTimestamp" | "lastActivityAt" | "updatedAt">>;

type AttentionBucket = "attention" | "needs_input";

function needsAttention<T extends ReviewAgent>(
  agent: T,
  agents: ReadonlyMap<string, T>,
  bucket: AttentionBucket,
): boolean {
  if (agent.archivedAt || !agent.workspaceId) return false;
  const review = getReviewStatus(agent.labels);
  const parent = agent.parentAgentId ? agents.get(agent.parentAgentId) : undefined;
  // A blocked child must be reachable even when it normally lives under its parent.
  if (
    bucket === "attention" &&
    !isWorkspaceRootAgent(agent, parent) &&
    !shouldAutoOpenAgentTab(agent) &&
    !review
  )
    return false;
  let status = agent.status;
  if (agent.turn.phase === "open") status = "running";
  else if (status === "running") status = "idle";
  return (
    deriveAgentStateBucket({
      status,
      labels: agent.labels,
      pendingPermissionCount: agent.pendingPermissions.length,
      requiresAttention: agent.requiresAttention,
      attentionReason: agent.attentionReason,
    }) === bucket
  );
}

/** Index each immutable host directory once, rather than rescanning it for every workspace row. */
export function createWorkspaceReviewSelector<T extends ReviewAgent>(
  bucket: AttentionBucket = "attention",
) {
  const cache = new WeakMap<ReadonlyMap<string, T>, ReadonlyMap<string, readonly T[]>>();
  const empty: readonly T[] = [];
  return (agents: ReadonlyMap<string, T> | undefined, workspaceId: string): readonly T[] => {
    if (!agents) return empty;
    let index = cache.get(agents);
    if (!index) {
      const next = new Map<string, T[]>();
      for (const agent of agents.values()) {
        if (!agent.workspaceId || !needsAttention(agent, agents, bucket)) continue;
        const rows = next.get(agent.workspaceId) ?? [];
        if (rows.length === 0) next.set(agent.workspaceId, rows);
        rows.push(agent);
      }
      const time = bucket === "needs_input" ? needsInputSince : reviewReplyTime;
      for (const rows of next.values())
        rows.sort((left, right) => time(right) - time(left) || left.id.localeCompare(right.id));
      index = next;
      cache.set(agents, index);
    }
    return index.get(workspaceId) ?? empty;
  };
}

export const workspaceReviewAgents = createWorkspaceReviewSelector<Agent>();
export const workspaceNeedsInputAgents = createWorkspaceReviewSelector<Agent>("needs_input");

function epoch(date: Date | null | undefined): number {
  const time = date?.getTime() ?? Number.NaN;
  return Number.isFinite(time) ? time : 0;
}

/**
 * When a session started needing input, in epoch ms (0 when unknown).
 *
 * A permission attention edge carries its own timestamp. Otherwise the session's last activity is
 * the moment it blocked: the host stamps every live stream event, the permission request included,
 * and a session waiting on someone emits nothing further. A manual Needs input marker stamps it too.
 */
export function needsInputSince(agent: ReviewAgent): number {
  if (agent.attentionReason === "permission") {
    const attention = epoch(agent.attentionTimestamp);
    if (attention > 0) return attention;
  }
  return epoch(agent.lastActivityAt) || epoch(agent.updatedAt);
}

/** The newest needs-input start across a workspace's sessions, or null when none needs input. */
export function newestNeedsInputSince(agents: readonly ReviewAgent[]): number | null {
  // Rows are already sorted newest first.
  const newest = agents[0];
  return newest ? needsInputSince(newest) || null : null;
}

function reviewReplyTime(agent: ReviewAgent): number {
  const reply = Date.parse(agent.messageActivity?.lastAssistantMessageAt ?? "");
  // Unknown historical reply times stay last; title, read and label changes cannot bump a row.
  return Number.isFinite(reply) ? reply : 0;
}
