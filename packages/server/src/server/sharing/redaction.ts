import {
  DEFAULT_REDACTION,
  type RedactionProfile,
  type ShareSnapshot,
  type SharedMessage,
} from "@getpaseo/protocol/sharing";
import type { AgentTimelineRow } from "../agent/agent-timeline-store-types.js";
import { TimelineProjection } from "../agent/timeline-projection.js";

// Keep broad patterns after specific patterns: replacements must not be re-counted.
export const SECRET_PATTERNS: readonly { name: string; pattern: RegExp }[] = [
  {
    name: "private key",
    pattern:
      /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----/g,
  },
  { name: "bearer", pattern: /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi },
  {
    name: "query",
    pattern:
      /([?&](?:token|key|secret|password|sig|signature|access_token)=)(?!\[secret hidden\])[^&#\s<>"']+/gi,
  },
  {
    name: "password",
    pattern: /\b(?:password|passwd)\s*[:=]\s*(?:"[^"\n]+"|'[^'\n]+'|[^\s,;<>]+)/gi,
  },
  { name: "openai", pattern: /\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}/g },
  { name: "github", pattern: /\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{16,}/g },
  { name: "aws", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "slack", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { name: "google", pattern: /\bAIza[A-Za-z0-9_-]{20,}/g },
  { name: "jwt", pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g },
  { name: "labelled", pattern: /\b(?:key|token|secret|auth)\b[^\n]{0,20}?[A-Za-z0-9_-]{32,}/gi },
  {
    name: "labelled suffix",
    pattern: /\b[A-Za-z0-9_-]{32,}[^\n]{0,20}?\b(?:key|token|secret|auth)\b/gi,
  },
];
const LOCAL_PATH =
  /(?:\/(?:Users|home|Volumes|private|tmp)\/|~\/|[A-Za-z]:\\Users\\)[^\s`"'<>\][)]+/g;
export interface SnapshotMetadata {
  title: string;
  ownerName: string;
  provider: string;
  model?: string;
  createdAt: string;
}
export function redactTimeline(
  rows: readonly AgentTimelineRow[],
  metadata: SnapshotMetadata,
  profile: RedactionProfile = DEFAULT_REDACTION,
): ShareSnapshot {
  const summary = {
    hiddenToolCalls: 0,
    hiddenReasoning: 0,
    secretsMasked: 0,
    pathsCollapsed: 0,
    contactsMasked: 0,
    messagesExcluded: 0,
  };
  const scrub = (input: string): string => {
    let text = input;
    // Literal patterns run first so a partial built-in match cannot defeat an owner rule.
    for (const literal of profile.extraPatterns) {
      if (!literal) continue;
      text = text
        .split(literal)
        .map((part, index) => {
          if (index) summary.secretsMasked++;
          return part;
        })
        .join("[secret hidden]");
    }
    if (profile.scrub.secrets)
      for (const { pattern } of SECRET_PATTERNS) {
        text = text.replace(pattern, (match: string, prefix?: string | number) => {
          // The query prefix is preserved without retaining its value.
          if (match.includes("[secret hidden]")) return match;
          summary.secretsMasked++;
          return typeof prefix === "string" ? `${prefix}[secret hidden]` : "[secret hidden]";
        });
      }
    if (profile.scrub.paths)
      text = text.replace(LOCAL_PATH, (value) => {
        summary.pathsCollapsed++;
        return `…/${value.replaceAll("\\", "/").split("/").filter(Boolean).slice(-2).join("/")}`;
      });
    if (profile.scrub.contacts)
      text = text.replace(
        /\b[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+\b|\+[1-9][0-9]{7,14}\b/g,
        (value) => {
          if (value === metadata.ownerName) return value;
          summary.contactsMasked++;
          return value.startsWith("+") ? "[phone]" : "[email]";
        },
      );
    return text;
  };
  const messages: SharedMessage[] = [];
  const projection = new TimelineProjection();
  for (const row of rows) projection.append(row);
  for (const row of projection.getRows()) {
    const item = row.item;
    const id =
      ("messageId" in item && typeof item.messageId === "string" ? item.messageId : undefined) ??
      `m_${row.seqStart}`;
    const at = row.timestamp;
    const omitted = (reason: "tool_calls" | "reasoning" | "excluded") => {
      const last = messages.at(-1);
      if (last?.kind === "omitted" && last.reason === reason) last.count++;
      else messages.push({ kind: "omitted", id, at, reason, count: 1 });
    };
    if (profile.excludedMessageIds.includes(id)) {
      summary.messagesExcluded++;
      omitted("excluded");
      continue;
    }
    switch (item.type) {
      case "user_message":
        messages.push({
          kind: "user",
          id,
          at,
          author: { name: metadata.ownerName, role: "owner" },
          text: scrub(item.text),
        });
        break;
      case "assistant_message":
        messages.push({ kind: "assistant", id, at, text: scrub(item.text) });
        break;
      case "tool_call":
        if (!profile.include.toolCalls) {
          summary.hiddenToolCalls++;
          omitted("tool_calls");
        }
        // Never interpolate provider-controlled names, summaries, args, errors or output.
        else messages.push({ kind: "assistant", id, at, text: toolSummary(item.detail.type) });
        break;
      case "reasoning":
        if (!profile.include.reasoning) {
          summary.hiddenReasoning++;
          omitted("reasoning");
        } else messages.push({ kind: "assistant", id, at, text: scrub(item.text) });
        break;
      case "error":
      case "notification":
        if (profile.include.errors)
          messages.push({ kind: "assistant", id, at, text: scrub(item.message) });
        break;
    }
  }
  return {
    v: 1,
    title: scrub(metadata.title),
    owner: { name: metadata.ownerName },
    agent: {
      provider: scrub(metadata.provider),
      ...(metadata.model ? { model: scrub(metadata.model) } : {}),
    },
    createdAt: metadata.createdAt,
    messages,
    redactionSummary: summary,
  };
}
function toolSummary(kind: string): string {
  switch (kind) {
    case "shell":
      return "Ran shell command";
    case "read":
      return "Read a file";
    case "edit":
    case "write":
      return "Changed a file";
    case "search":
      return "Searched files";
    default:
      return "Used a tool";
  }
}
