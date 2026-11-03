import { getReviewStatus, MANUAL_NEEDS_INPUT_LABEL } from "./agent-labels.js";
import type { AgentLifecycleStatus } from "./agent-lifecycle.js";
import { needsUserInput, type CompanionEntry } from "./companion-stream.js";
import type { WorkspaceStateBucket } from "./messages.js";

export type { WorkspaceStateBucket };
export type AgentAttentionReason = "finished" | "error" | "permission" | null | undefined;

export interface AgentStateBucketInput {
  status: AgentLifecycleStatus;
  labels?: Record<string, unknown> | null;
  pendingPermissionCount?: number;
  requiresAttention?: boolean;
  attentionReason?: AgentAttentionReason;
  /**
   * Stream items in this chat waiting on the user now (blocked asks, open needed-input
   * questions, pending permissions), excluding ones set aside for Later.
   */
  needsYouCount?: number;
}

/** A chat's Needs you items that are waiting now: Later items wait until brought back. */
export function countNeedsYouNow(entries: readonly CompanionEntry[] | null | undefined): number {
  let count = 0;
  for (const entry of entries ?? []) if (!entry.deferredAt && needsUserInput(entry)) count++;
  return count;
}

function needsInput(input: AgentStateBucketInput): boolean {
  return (
    (input.pendingPermissionCount ?? 0) > 0 ||
    input.attentionReason === "permission" ||
    input.labels?.[MANUAL_NEEDS_INPUT_LABEL] === "true" ||
    (input.needsYouCount ?? 0) > 0
  );
}

const WORKSPACE_STATE_BUCKET_PRIORITY = {
  needs_input: 0,
  failed: 1,
  running: 2,
  attention: 3,
  done: 4,
} as const satisfies Record<WorkspaceStateBucket, number>;

export function deriveAgentStateBucket(input: AgentStateBucketInput): WorkspaceStateBucket {
  if (needsInput(input)) {
    return "needs_input";
  }
  if (input.status === "error" || input.attentionReason === "error") {
    return "failed";
  }
  if (input.status === "running") {
    return "running";
  }
  const review = getReviewStatus(input.labels);
  if (input.requiresAttention || (review !== null && review !== "approved")) {
    return "attention";
  }
  return "done";
}

export function getWorkspaceStateBucketPriority(bucket: WorkspaceStateBucket): number {
  return WORKSPACE_STATE_BUCKET_PRIORITY[bucket];
}

export function getAgentStatusPriority(input: AgentStateBucketInput): number {
  if (needsInput(input)) {
    return 0;
  }
  if (input.status === "error" || input.attentionReason === "error") {
    return 1;
  }
  if (input.status === "running") {
    return 2;
  }
  if (input.status === "initializing") {
    return 3;
  }
  return 4;
}
