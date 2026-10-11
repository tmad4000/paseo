import type { Agent, WorkspaceDescriptor } from "@/stores/session-store";
import { isWorkspaceRootAgent } from "@/subagents/policies";
import { deriveSidebarStateBucket } from "./sidebar-agent-state";

export interface WorkspaceAgentActivity {
  agentId: string;
  status: WorkspaceDescriptor["status"];
  enteredAt: Date | null;
  lastActivityAt: Date;
  lastMessageAt?: Date;
  lastUserMessageAt?: Date;
  lastAssistantMessageAt?: Date;
}

function workspaceAgentStatus(agent: Agent): Agent["status"] {
  if (agent.turn.phase === "open") return "running";
  return agent.status === "running" ? "idle" : agent.status;
}

export function buildWorkspaceAgentActivityIndex(
  agents: ReadonlyMap<string, Agent>,
  previous?: ReadonlyMap<string, WorkspaceAgentActivity>,
): Map<string, WorkspaceAgentActivity> {
  const activityByWorkspaceId = new Map<string, WorkspaceAgentActivity>();
  const latestActivityAtByWorkspaceId = new Map<string, Date>();
  const latestMessageAtByWorkspaceId = new Map<string, Date>();
  const conversationAt = new Map<string, Date>();
  const userAt = new Map<string, Date>();
  const assistantAt = new Map<string, Date>();

  for (const agent of agents.values()) {
    const parentAgent = agent.parentAgentId ? agents.get(agent.parentAgentId) : undefined;
    if (agent.archivedAt || !agent.workspaceId || !isWorkspaceRootAgent(agent, parentAgent)) {
      continue;
    }

    recordLatestActivity(latestMessageAtByWorkspaceId, agent.workspaceId, agent.lastActivityAt);
    const clocks = agentMessageTimestamps(agent);
    recordLatestActivity(userAt, agent.workspaceId, clocks.user);
    recordLatestActivity(assistantAt, agent.workspaceId, clocks.assistant);
    recordLatestActivity(conversationAt, agent.workspaceId, clocks.conversation);

    const enteredAt = agent.attentionTimestamp ?? agent.updatedAt;
    const latestActivityAt = latestActivityAtByWorkspaceId.get(agent.workspaceId);
    if (latestActivityAt && enteredAt <= latestActivityAt) {
      continue;
    }
    latestActivityAtByWorkspaceId.set(agent.workspaceId, enteredAt);

    const status = deriveSidebarStateBucket({
      status: workspaceAgentStatus(agent),
      pendingPermissionCount: agent.pendingPermissions.length,
      requiresAttention: agent.requiresAttention,
      attentionReason: agent.attentionReason,
    });
    activityByWorkspaceId.set(agent.workspaceId, {
      agentId: agent.id,
      status,
      enteredAt,
      lastActivityAt: agent.lastActivityAt,
    });
  }

  for (const [workspaceId, activity] of activityByWorkspaceId) {
    activity.lastMessageAt = conversationAt.get(workspaceId);
    activity.lastUserMessageAt = userAt.get(workspaceId);
    activity.lastAssistantMessageAt = assistantAt.get(workspaceId);
    activity.lastActivityAt =
      latestMessageAtByWorkspaceId.get(workspaceId) ?? activity.lastActivityAt;
    const previousActivity = previous?.get(workspaceId);
    if (
      previousActivity?.agentId === activity.agentId &&
      previousActivity.status === activity.status
    ) {
      activityByWorkspaceId.set(
        workspaceId,
        sameMessageActivity(previousActivity, activity)
          ? previousActivity
          : { ...activity, enteredAt: previousActivity.enteredAt },
      );
    }
  }

  if (previous && areWorkspaceAgentActivityIndexesIdentical(previous, activityByWorkspaceId)) {
    return previous instanceof Map ? previous : new Map(previous);
  }
  return activityByWorkspaceId;
}

function recordLatestActivity(
  activityByWorkspaceId: Map<string, Date>,
  workspaceId: string,
  at: Date,
) {
  const previous = activityByWorkspaceId.get(workspaceId);
  if (!previous || at > previous) activityByWorkspaceId.set(workspaceId, at);
}

function areWorkspaceAgentActivityIndexesIdentical(
  previous: ReadonlyMap<string, WorkspaceAgentActivity>,
  next: ReadonlyMap<string, WorkspaceAgentActivity>,
): boolean {
  if (previous.size !== next.size) {
    return false;
  }
  for (const [workspaceId, activity] of next) {
    if (previous.get(workspaceId) !== activity) {
      return false;
    }
  }
  return true;
}

function messageTimestamp(value: string | null | undefined): Date | undefined {
  const time = Date.parse(value ?? "");
  return Number.isFinite(time) ? new Date(time) : undefined;
}

function agentMessageTimestamps(agent: Agent): { user: Date; assistant: Date; conversation: Date } {
  // Daemons older than conversationMessageActivity send no messageActivity at all; their legacy
  // lastUserMessageAt keeps those chats in a sensible place under the message sorts.
  const user = agent.messageActivity
    ? messageTimestamp(agent.messageActivity.lastUserMessageAt)
    : (agent.lastUserMessageAt ?? undefined);
  const assistant = messageTimestamp(agent.messageActivity?.lastAssistantMessageAt);
  let conversation = user ?? assistant ?? agent.createdAt;
  if (user && assistant && assistant > user) conversation = assistant;
  return { user: user ?? agent.createdAt, assistant: assistant ?? agent.createdAt, conversation };
}
function sameMessageActivity(left: WorkspaceAgentActivity, right: WorkspaceAgentActivity): boolean {
  return (
    left.lastActivityAt.getTime() === right.lastActivityAt.getTime() &&
    left.lastMessageAt?.getTime() === right.lastMessageAt?.getTime() &&
    left.lastUserMessageAt?.getTime() === right.lastUserMessageAt?.getTime() &&
    left.lastAssistantMessageAt?.getTime() === right.lastAssistantMessageAt?.getTime()
  );
}
