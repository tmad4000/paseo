import { randomUUID } from "node:crypto";
import { isCompanionEntryPending, type CompanionEntry } from "@getpaseo/protocol/companion-stream";
import type { AgentPermissionRequest, AgentStreamEvent } from "./agent-sdk-types.js";

export const COMPANION_ENTRY_LIMIT = 50;
export const COMPANION_TEXT_LIMIT = 4000;

interface ResponseDraft {
  text: string;
  messageId: string | undefined;
  truncated: boolean;
}

function excerpt(text: string): { text: string; truncated: boolean } {
  return {
    text: text.slice(0, COMPANION_TEXT_LIMIT),
    truncated: text.length > COMPANION_TEXT_LIMIT,
  };
}

function requestQuestions(request: AgentPermissionRequest): string[] {
  const questions = request.input?.questions;
  if (!Array.isArray(questions)) return [];
  return questions.flatMap((question: unknown) => {
    if (typeof question !== "object" || question === null || !("question" in question)) return [];
    return typeof question.question === "string" && question.question.trim()
      ? [question.question]
      : [];
  });
}

function requestText(request: AgentPermissionRequest): string {
  const text = requestQuestions(request).join("\n\n");
  if (text) return text;
  if (request.kind === "plan") {
    if (typeof request.metadata?.planText === "string") return request.metadata.planText;
    if (typeof request.input?.plan === "string") return request.input.plan;
  }
  if (request.detail?.type === "plain_text" && request.detail.text) return request.detail.text;
  if (request.detail?.type === "plan") return request.detail.text;
  if (request.detail?.type === "shell") return request.detail.command;
  return request.description || request.title || request.name;
}

export function restoreCompanionEntries(options?: {
  companionEntries?: CompanionEntry[];
}): CompanionEntry[] {
  const entries = options?.companionEntries ?? [];
  // Provider requests do not survive session recreation. Do not present an old approval as live.
  return entries.map(expirePendingPermission);
}

function expirePendingPermission(entry: CompanionEntry): CompanionEntry {
  if (entry.kind !== "permission" || entry.status !== "pending") return entry;
  if (entry.requestKind === "question") {
    // The provider request is no longer answerable, but the needed input survives.
    return {
      id: entry.id,
      kind: "question",
      status: "open",
      timestamp: entry.timestamp,
      text: entry.text,
      truncated: entry.truncated,
    };
  }
  return { ...entry, status: "expired" };
}

export class CompanionStreamCollector {
  private readonly drafts = new Map<string, Map<string, ResponseDraft>>();

  clear(agentId: string): void {
    this.drafts.delete(agentId);
  }

  observe(
    agentId: string,
    entries: CompanionEntry[],
    event: AgentStreamEvent,
    timestamp: string,
  ): CompanionEntry[] {
    const turnKey = "turnId" in event ? (event.turnId ?? "unscoped") : "unscoped";
    const turns = this.drafts.get(agentId) ?? new Map<string, ResponseDraft>();
    if (event.type === "turn_started") {
      turns.delete(turnKey);
      this.drafts.set(agentId, turns);
    }
    if (event.type === "timeline") {
      return this.observeTimeline(agentId, entries, event, turnKey, turns);
    }
    if (event.type === "permission_requested") {
      const questions = event.request.kind === "question" ? requestQuestions(event.request) : [];
      let next = entries;
      for (const [index, text] of (questions.length
        ? questions
        : [requestText(event.request)]
      ).entries()) {
        next = upsert(next, {
          id: `permission:${event.request.id}${index ? `:question:${index}` : ""}`,
          kind: "permission",
          timestamp,
          requestId: event.request.id,
          requestKind: event.request.kind,
          status: "pending",
          ...excerpt(text),
        });
      }
      return next;
    }
    if (event.type === "permission_resolved") {
      return mapChanged(entries, (entry) => {
        if (entry.kind !== "permission" || entry.requestId !== event.requestId) return entry;
        if (event.disposition === "expired") return expirePendingPermission(entry);
        return { ...entry, status: event.resolution.behavior === "allow" ? "allowed" : "denied" };
      });
    }
    if (
      event.type !== "turn_completed" &&
      event.type !== "turn_failed" &&
      event.type !== "turn_canceled"
    )
      return entries;

    const draft = turns.get(turnKey);
    turns.delete(turnKey);
    if (turns.size === 0) this.drafts.delete(agentId);
    return collectOutcome(entries, event, timestamp, draft);
  }

  private observeTimeline(
    agentId: string,
    entries: CompanionEntry[],
    event: Extract<AgentStreamEvent, { type: "timeline" }>,
    turnKey: string,
    turns: Map<string, ResponseDraft>,
  ): CompanionEntry[] {
    const item = event.item;
    if (item.type === "assistant_message") {
      const previous = turns.get(turnKey);
      const sameMessage = previous && previous.messageId === item.messageId;
      const next = excerpt((sameMessage ? previous.text : "") + item.text);
      turns.set(turnKey, {
        ...next,
        messageId: item.messageId,
        truncated: next.truncated || Boolean(sameMessage && previous.truncated),
      });
      this.drafts.set(agentId, turns);
    } else if (item.type === "tool_call" || item.type === "user_message") {
      // Only the final response is a review card, not intermediate tool narration.
      turns.delete(turnKey);
    }
    // A message is not evidence that any particular question has been answered.
    // Questions are resolved individually by an explicit status update.
    return entries;
  }
}

function collectOutcome(
  entries: CompanionEntry[],
  event: Extract<AgentStreamEvent, { type: "turn_completed" | "turn_failed" | "turn_canceled" }>,
  timestamp: string,
  draft: ResponseDraft | undefined,
): CompanionEntry[] {
  const id = `turn:${event.turnId ?? randomUUID()}`;
  if (entries.some((entry) => entry.id === id)) return entries;
  let next = entries;
  if (event.type !== "turn_completed") {
    next = mapChanged(next, expirePendingPermission);
  }
  const text = draft?.text.trim() ?? "";
  const questions = event.type === "turn_completed" ? extractCompanionQuestions(text) : [];
  for (const [index, question] of questions.entries()) {
    next = upsert(next, {
      id: `${id}:question${index ? `:${index}` : ""}`,
      kind: "question",
      timestamp,
      text: question,
      truncated: draft?.truncated ?? false,
      status: "open",
    });
  }
  let outcomeText = questions.length === 1 && questions[0] === text ? "" : text;
  let status: "completed" | "failed" | "canceled" = "completed";
  if (event.type === "turn_failed") {
    outcomeText = event.error;
    status = "failed";
  } else if (event.type === "turn_canceled") {
    outcomeText = event.reason;
    status = "canceled";
  }
  return upsert(next, {
    id,
    kind: "outcome",
    timestamp,
    ...excerpt(outcomeText),
    truncated:
      outcomeText === text
        ? (draft?.truncated ?? false)
        : outcomeText.length > COMPANION_TEXT_LIMIT,
    status,
  });
}

/**
 * Returns the input array itself when no element changed. The agent manager emits a
 * fresh agent state whenever the entries reference changes, and an emit that carries
 * no change still tells every client the agent is running before the authoritative
 * turn and status messages arrive.
 */
function mapChanged(
  entries: CompanionEntry[],
  update: (entry: CompanionEntry) => CompanionEntry,
): CompanionEntry[] {
  let changed = false;
  const next = entries.map((entry) => {
    const updated = update(entry);
    if (updated !== entry) changed = true;
    return updated;
  });
  return changed ? next : entries;
}

function upsert(entries: CompanionEntry[], entry: CompanionEntry): CompanionEntry[] {
  const existing = entries.find((item) => item.id === entry.id);
  const next = existing
    ? entries.map((item) => (item.id === entry.id ? { ...entry, timestamp: item.timestamp } : item))
    : [...entries, entry];
  return retainCompanionEntries(next);
}

export function retainCompanionEntries(entries: CompanionEntry[]): CompanionEntry[] {
  // Durable user context and unresolved work do not compete with transient outcomes.
  const durable = (entry: CompanionEntry) => entry.kind === "pin" || isCompanionEntryPending(entry);
  const recent = new Set(entries.filter((entry) => !durable(entry)).slice(-COMPANION_ENTRY_LIMIT));
  return entries.filter((entry) => durable(entry) || recent.has(entry));
}

/** Capture explicit question lines and lists explicitly labelled as needing input.
 * This is syntax recognition, not a semantic claim about every question in history.
 * Agents use set_stream_question for authoritative, individually resolvable items.
 */
export function extractCompanionQuestions(text: string): string[] {
  const prose = text.replace(/```[\s\S]*?```/g, "\n");
  const questions: string[] = [];
  let inputSection = false;
  for (const raw of prose.split("\n")) {
    const originalLine = raw.trim();
    const line = originalLine.replace(/`[^`]*`|https?:\/\/\S+/g, "").trim();
    const heading = line.replace(/^[#*\s]+|[*:\s]+$/g, "");
    if (
      /^(?:still )?(?:need(?:s)? (?:your )?input|open questions|questions for you|pending decisions|awaiting your (?:answer|input))$/i.test(
        heading,
      )
    ) {
      inputSection = true;
      continue;
    }
    if (/^#{1,6}\s|^\*\*[^*]+\*\*:?$/.test(line)) inputSection = false;
    const listItem = line.match(/^(?:[-*+] |\d+[.)] )(.+)$/);
    if (/[?？]\s*$/.test(line) || (inputSection && listItem)) {
      const question = listItem ? originalLine.replace(/^(?:[-*+] |\d+[.)] )/, "") : originalLine;
      if (question) questions.push(question);
    } else if (line && !listItem) inputSection = false;
  }
  return [...new Set(questions)];
}
