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
>;

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
      for (const rows of next.values())
        rows.sort(
          (left, right) =>
            reviewReplyTime(right) - reviewReplyTime(left) || left.id.localeCompare(right.id),
        );
      index = next;
      cache.set(agents, index);
    }
    return index.get(workspaceId) ?? empty;
  };
}

export const workspaceReviewAgents = createWorkspaceReviewSelector<Agent>();
export const workspaceNeedsInputAgents = createWorkspaceReviewSelector<Agent>("needs_input");

function reviewReplyTime(agent: ReviewAgent): number {
  const reply = Date.parse(agent.messageActivity?.lastAssistantMessageAt ?? "");
  // Unknown historical reply times stay last; title, read and label changes cannot bump a row.
  return Number.isFinite(reply) ? reply : 0;
}
