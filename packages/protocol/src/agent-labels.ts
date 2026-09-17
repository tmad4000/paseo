export const PARENT_AGENT_ID_LABEL = "paseo.parent-agent-id";
// Placement hint: clients reconcile this agent in as a workspace tab even when
// the visibility policy (workspace-root only) would hide it. Set by open_tab
// and by CLI-created agents; cleared by close_tab.
export const AUTO_OPEN_AGENT_TAB_LABEL = "paseo.auto-open-agent-tab";
// Review status: an agent (usually a delegated subagent) marks its work
// "ready" for a human/orchestrator to review instead of just going idle.
// Distinct from lifecycle: a review-ready agent is idle AND waiting on review.
export const REVIEW_STATUS_LABEL = "paseo.review-status";
export const REVIEW_NOTE_LABEL = "paseo.review-note";
const OPEN_AGENT_TAB_LABEL_PREFIX = "paseo.open-agent-tab.";

export const REVIEW_STATUSES = ["ready", "in_review", "changes_requested", "approved"] as const;

export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export function isReviewStatus(value: unknown): value is ReviewStatus {
  return typeof value === "string" && (REVIEW_STATUSES as readonly string[]).includes(value);
}

export function getReviewStatus(
  labels: Record<string, unknown> | null | undefined,
): ReviewStatus | null {
  const value = labels?.[REVIEW_STATUS_LABEL];
  return isReviewStatus(value) ? value : null;
}

export function getReviewNote(labels: Record<string, unknown> | null | undefined): string | null {
  const value = labels?.[REVIEW_NOTE_LABEL];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function getOpenAgentTabLabel(clientId: string): string {
  return `${OPEN_AGENT_TAB_LABEL_PREFIX}${clientId}`;
}

export function isOpenAgentTabLabel(label: string): boolean {
  return label.startsWith(OPEN_AGENT_TAB_LABEL_PREFIX);
}

export interface AgentLabelSource {
  labels?: Record<string, unknown> | null;
}

export function getParentAgentIdFromLabels(labels: Record<string, unknown> | null | undefined) {
  const parentAgentId = labels?.[PARENT_AGENT_ID_LABEL];
  return typeof parentAgentId === "string" && parentAgentId.trim().length > 0
    ? parentAgentId.trim()
    : null;
}

export function isDelegatedAgent(agent: AgentLabelSource): boolean {
  return getParentAgentIdFromLabels(agent.labels) !== null;
}

export function shouldAutoOpenAgentTab(agent: AgentLabelSource): boolean {
  return agent.labels?.[AUTO_OPEN_AGENT_TAB_LABEL] === "true";
}

export function hasOpenAgentTab(labels: Record<string, unknown> | null | undefined): boolean {
  return Object.entries(labels ?? {}).some(
    ([label, value]) => isOpenAgentTabLabel(label) && value === "true",
  );
}
