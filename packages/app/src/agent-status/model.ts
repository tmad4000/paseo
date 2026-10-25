import {
  getReviewStatus,
  MANUAL_NEEDS_INPUT_LABEL,
  REVIEW_NOTE_LABEL,
  REVIEW_STATUS_LABEL,
  REVIEW_STATUSES,
} from "@getpaseo/protocol/agent-labels";
import type { AgentSnapshotPayload } from "@getpaseo/protocol/messages";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

export const MANUAL_STATUSES = ["needs_input", ...REVIEW_STATUSES, "clear"] as const;
export type ManualStatus = (typeof MANUAL_STATUSES)[number];
export type ManualStatusTarget = { serverId: string } & (
  | { kind: "agent"; agentId: string }
  | { kind: "workspace"; workspaceId: string }
);

export function manualStatus(labels: Record<string, unknown>): ManualStatus {
  if (labels[MANUAL_NEEDS_INPUT_LABEL] === "true") return "needs_input";
  return getReviewStatus(labels) ?? "clear";
}

export function manualStatusPatch(status: ManualStatus): Record<string, string | null> {
  const review = status === "clear" || status === "needs_input" ? null : status;
  return {
    [MANUAL_NEEDS_INPUT_LABEL]: status === "needs_input" ? "true" : null,
    [REVIEW_STATUS_LABEL]: review,
    ...(review === null ? { [REVIEW_NOTE_LABEL]: null } : {}),
  };
}

/** Snapshot the complete target before writing: pagination cannot skip agents as labels change. */
export async function loadStatusTargets(
  client: Pick<DaemonClient, "fetchAgent" | "fetchAgents">,
  target: ManualStatusTarget,
): Promise<AgentSnapshotPayload[]> {
  if (target.kind === "agent") {
    const result = await client.fetchAgent(target.agentId);
    return result ? [result.agent] : [];
  }
  const agents: AgentSnapshotPayload[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.fetchAgents({
      filter: { includeArchived: false },
      sort: [{ key: "created_at", direction: "asc" }],
      page: { limit: 200, ...(cursor ? { cursor } : {}) },
    });
    agents.push(...page.entries.map((entry) => entry.agent));
    cursor = page.pageInfo.nextCursor ?? undefined;
  } while (cursor);
  return agents.filter((agent) => !agent.archivedAt && agent.workspaceId === target.workspaceId);
}
