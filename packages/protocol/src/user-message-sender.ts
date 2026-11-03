/**
 * Who sent a user turn, and who created an agent. The wire carries a plain string so a newer
 * daemon can add kinds without old clients rejecting the message; read it through these helpers.
 *
 * - `human`: typed, spoken, or otherwise submitted by a person through a Paseo client.
 * - `agent:<agentId>`: injected by another agent (send_agent_prompt, create_agent).
 * - `schedule`: a schedule or heartbeat run.
 */
export type UserMessageSender = "human" | "schedule" | `agent:${string}`;

export const HUMAN_SENDER = "human" satisfies UserMessageSender;
export const SCHEDULE_SENDER = "schedule" satisfies UserMessageSender;
const AGENT_SENDER_PREFIX = "agent:";

export function agentSender(agentId: string): UserMessageSender {
  return `${AGENT_SENDER_PREFIX}${agentId}`;
}

export function parseUserMessageSender(value: unknown): UserMessageSender | null {
  if (value === HUMAN_SENDER || value === SCHEDULE_SENDER) return value;
  if (typeof value === "string" && value.startsWith(AGENT_SENDER_PREFIX)) {
    const agentId = value.slice(AGENT_SENDER_PREFIX.length).trim();
    return agentId ? agentSender(agentId) : null;
  }
  return null;
}

/** The agent id of an `agent:<id>` sender, otherwise null. */
export function getSenderAgentId(value: unknown): string | null {
  const sender = parseUserMessageSender(value);
  return sender?.startsWith(AGENT_SENDER_PREFIX) ? sender.slice(AGENT_SENDER_PREFIX.length) : null;
}

export function isHumanSender(value: unknown): boolean {
  return value === HUMAN_SENDER;
}

/**
 * Agents persisted before createdBy existed: a child created through create_agent carries the
 * parent label, everything else was started by a person.
 */
export function resolveAgentCreatedBy(input: {
  createdBy?: string | null;
  parentAgentId?: string | null;
}): UserMessageSender {
  const recorded = parseUserMessageSender(input.createdBy);
  if (recorded) return recorded;
  return input.parentAgentId ? agentSender(input.parentAgentId) : HUMAN_SENDER;
}
