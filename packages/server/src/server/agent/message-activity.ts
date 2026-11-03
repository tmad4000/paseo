import type { AgentTimelineItem } from "./agent-sdk-types.js";
import { isHumanSender, type UserMessageSender } from "@getpaseo/protocol/user-message-sender";
import { isSystemInjectedEnvelope } from "./agent-prompt.js";

export interface MessageActivity {
  lastUserMessageAt: string | null;
  lastAssistantMessageAt: string | null;
  /**
   * Latest user turn a person sent. Absent only on records persisted before sender tracking;
   * seedLegacyHumanActivity fills it on load.
   */
  lastHumanMessageAt?: string | null;
}

type MessageActivityRole = "user" | "assistant" | "human";

const ACTIVITY_KEY = {
  user: "lastUserMessageAt",
  assistant: "lastAssistantMessageAt",
  human: "lastHumanMessageAt",
} as const satisfies Record<MessageActivityRole, keyof MessageActivity>;

export function emptyMessageActivity(): MessageActivity {
  return { lastUserMessageAt: null, lastAssistantMessageAt: null, lastHumanMessageAt: null };
}

/**
 * Records from before sender tracking cannot say who sent their last turn. A human-created
 * agent keeps its last user time as human time; a delegated one starts with none.
 */
export function seedLegacyHumanActivity(
  activity: MessageActivity,
  createdBy: UserMessageSender,
): MessageActivity {
  if (activity.lastHumanMessageAt !== undefined) return activity;
  return {
    ...activity,
    lastHumanMessageAt: isHumanSender(createdBy) ? activity.lastUserMessageAt : null,
  };
}

/** Caller supplies acceptance/completion time for live messages, never a token timestamp. */
export function advanceMessageActivity(
  activity: MessageActivity,
  role: MessageActivityRole,
  timestamp: string | Date | undefined,
): MessageActivity {
  const time = timestamp instanceof Date ? timestamp.getTime() : Date.parse(timestamp ?? "");
  if (!Number.isFinite(time)) return activity;
  const key = ACTIVITY_KEY[role];
  const previous = Date.parse(activity[key] ?? "");
  if (Number.isFinite(previous) && previous >= time) return activity;
  return { ...activity, [key]: new Date(time).toISOString() };
}

/**
 * Only original provider dates qualify: undated history must not become new activity
 * on import. System notifications are not user-authored activity. Provider history carries
 * no sender, so an unattributed turn counts as human only when `unattributedIsHuman` (the
 * agent itself was started by a person).
 */
export function deriveHistoricalMessageActivity(
  events: Iterable<{ item: AgentTimelineItem; timestamp?: string }>,
  options?: { unattributedIsHuman?: boolean },
): MessageActivity {
  let activity = emptyMessageActivity();
  for (const { item, timestamp } of events) {
    if (item.type === "user_message" && !isSystemInjectedEnvelope(item.text)) {
      activity = advanceMessageActivity(activity, "user", timestamp);
      const human =
        item.sender === undefined
          ? options?.unattributedIsHuman === true
          : isHumanSender(item.sender);
      if (human) activity = advanceMessageActivity(activity, "human", timestamp);
    } else if (item.type === "assistant_message" && item.text.trim()) {
      activity = advanceMessageActivity(activity, "assistant", timestamp);
    }
  }
  return activity;
}
