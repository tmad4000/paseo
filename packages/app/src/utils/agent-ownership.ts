import {
  getSenderAgentId,
  isHumanSender,
  resolveAgentCreatedBy,
  type UserMessageSender,
} from "@getpaseo/protocol/user-message-sender";
import type { Agent } from "@/stores/session-store";

/**
 * Whose agent session this is. "Mine" means a person started it or has talked to it; everything
 * else was delegated by another agent or started by a schedule. See docs/sidebar-filter.md.
 */
export type AgentOwnershipInput = Pick<
  Agent,
  "createdBy" | "parentAgentId" | "messageActivity" | "lastUserMessageAt"
>;

interface AgentCreatorInput {
  createdBy?: string | null;
  parentAgentId?: string | null;
}

export function agentCreatedBy(agent: AgentCreatorInput): UserMessageSender {
  return resolveAgentCreatedBy({ createdBy: agent.createdBy, parentAgentId: agent.parentAgentId });
}

function parseTimestamp(value: string | null | undefined): Date | null {
  const time = Date.parse(value ?? "");
  return Number.isFinite(time) ? new Date(time) : null;
}

/**
 * When a person last sent this agent a turn. Hosts that predate sender tracking omit
 * `lastHumanMessageAt`; there a human-created agent's last user message stands in for it.
 */
export function agentHumanMessageAt(agent: AgentOwnershipInput): Date | null {
  const recorded = agent.messageActivity?.lastHumanMessageAt;
  if (recorded !== undefined) return parseTimestamp(recorded);
  if (!isHumanSender(agentCreatedBy(agent))) return null;
  // COMPAT(userMessageSender): added after fork v0.10.0-beta.22, remove after 2027-05-01.
  return agent.messageActivity
    ? parseTimestamp(agent.messageActivity.lastUserMessageAt)
    : agent.lastUserMessageAt;
}

export function isMineAgent(agent: AgentOwnershipInput): boolean {
  return isHumanSender(agentCreatedBy(agent)) || agentHumanMessageAt(agent) !== null;
}

/** The agent that delegated this one, from the parent label or a recorded agent creator. */
export function agentDelegatorId(agent: AgentCreatorInput): string | null {
  return agent.parentAgentId ?? getSenderAgentId(agentCreatedBy(agent));
}

/** The delegator's title, or its short id when this client has not loaded it. */
export function formatDelegatorName(input: {
  delegatorId: string;
  delegatorTitle: string | null | undefined;
}): string {
  const title = input.delegatorTitle?.trim();
  return title ? title : input.delegatorId.slice(0, 7);
}
