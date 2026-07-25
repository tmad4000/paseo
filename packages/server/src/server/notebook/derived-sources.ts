import type { AgentArtifact } from "@getpaseo/protocol/agent-types";
import type { AgentTimelineRow } from "../agent/agent-timeline-store-types.js";

export interface DerivedNotebookLink {
  url: string;
  source: {
    agentId: string;
    timelineSequence: number;
    messageId?: string;
    role: "user" | "assistant";
  };
}

export interface DerivedNotebookSources {
  links: DerivedNotebookLink[];
  artifacts: AgentArtifact[];
}

interface MessageSource {
  firstSequence: number;
  role: "user" | "assistant";
  messageId?: string;
  text: string;
}

const HTTP_URL_PATTERN = /https?:\/\/[^\s<>"'`]+/giu;
const SIMPLE_TRAILING_PUNCTUATION = /[.,;:!?]$/u;

export function deriveNotebookSources(input: {
  agentId: string;
  timelineRows: readonly AgentTimelineRow[];
  artifacts: readonly AgentArtifact[];
}): DerivedNotebookSources {
  const messages = collectMessages(input.timelineRows);
  const linksByUrl = new Map<string, DerivedNotebookLink>();

  for (const message of messages) {
    for (const candidate of message.text.match(HTTP_URL_PATTERN) ?? []) {
      const url = normalizeCapturedUrl(candidate);
      if (!url || linksByUrl.has(url)) {
        continue;
      }
      linksByUrl.set(url, {
        url,
        source: {
          agentId: input.agentId,
          timelineSequence: message.firstSequence,
          ...(message.messageId ? { messageId: message.messageId } : {}),
          role: message.role,
        },
      });
    }
  }

  return {
    links: Array.from(linksByUrl.values()),
    artifacts: [...input.artifacts].sort(
      (left, right) =>
        left.updatedAt.localeCompare(right.updatedAt) || left.path.localeCompare(right.path),
    ),
  };
}

function collectMessages(rows: readonly AgentTimelineRow[]): MessageSource[] {
  const messages: MessageSource[] = [];
  const byIdentity = new Map<string, MessageSource>();

  for (const row of rows) {
    if (row.item.type !== "user_message" && row.item.type !== "assistant_message") {
      continue;
    }
    const role = row.item.type === "user_message" ? "user" : "assistant";
    const identity = row.item.messageId
      ? `${role}:${row.item.messageId}`
      : `${role}:seq:${row.seq}`;
    const existing = byIdentity.get(identity);
    if (existing) {
      existing.text += row.item.text;
      continue;
    }
    const message: MessageSource = {
      firstSequence: row.seq,
      role,
      ...(row.item.messageId ? { messageId: row.item.messageId } : {}),
      text: row.item.text,
    };
    byIdentity.set(identity, message);
    messages.push(message);
  }

  return messages;
}

function normalizeCapturedUrl(candidate: string): string | null {
  let trimmed = candidate;
  while (SIMPLE_TRAILING_PUNCTUATION.test(trimmed)) {
    trimmed = trimmed.slice(0, -1);
  }
  trimmed = trimUnbalancedClosingDelimiter(trimmed, "(", ")");
  trimmed = trimUnbalancedClosingDelimiter(trimmed, "[", "]");
  trimmed = trimUnbalancedClosingDelimiter(trimmed, "{", "}");

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function trimUnbalancedClosingDelimiter(value: string, open: string, close: string): string {
  let next = value;
  while (next.endsWith(close) && count(next, close) > count(next, open)) {
    next = next.slice(0, -1);
  }
  return next;
}

function count(value: string, needle: string): number {
  return value.split(needle).length - 1;
}
