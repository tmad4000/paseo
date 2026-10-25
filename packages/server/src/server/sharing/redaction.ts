import { isIP } from "node:net";
import {
  DEFAULT_REDACTION,
  type RedactionProfile,
  type ShareSnapshot,
  type SharedMessage,
} from "@getpaseo/protocol/sharing";
import type { AgentTimelineRow } from "../agent/agent-timeline-store-types.js";
import { TimelineProjection } from "../agent/timeline-projection.js";

// Keep specific credentials ahead of generic tokens, and preserve labels for readable previews.
export const SECRET_PATTERNS: readonly {
  name: string;
  pattern: RegExp;
  replace?: (match: string, prefix: string) => string;
}[] = [
  {
    name: "private key",
    pattern:
      /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----/g,
  },
  {
    name: "URL userinfo",
    pattern: /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@?#<>"']+@/gi,
    replace: (_match, prefix) => `${prefix}[credentials]@`,
  },
  {
    name: "basic auth",
    pattern: /(\bBasic\s+)[A-Za-z0-9+/]+=*/gi,
    replace: (_match, prefix) => `${prefix}[secret hidden]`,
  },
  { name: "bearer", pattern: /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi },
  {
    name: "query",
    pattern: /([?&](?:token|key|secret|password|sig|signature|access_token)=)[^&#\s<>"']+/gi,
    replace: (_match, prefix) => `${prefix}[secret hidden]`,
  },
  {
    name: "labelled value",
    pattern:
      /\b([A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL)[A-Z0-9_]*\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|\S+)/gi,
    replace: (_match, prefix) => `${prefix}[secret hidden]`,
  },
  {
    name: "prose password",
    pattern: /\b((?:password|passphrase|passcode|pin)\s+(?:is|was|=|:)\s+)\S+/gi,
    replace: (_match, prefix) => `${prefix}[secret hidden]`,
  },
  {
    name: "CLI credential flag",
    pattern:
      /((?<![A-Za-z0-9_-])(?:--password|--token|--api-key|--secret|--key|-p)(?:=|\s+))(?:"[^"\r\n]*"|'[^'\r\n]*'|\S+)/g,
    replace: (_match, prefix) => `${prefix}[secret hidden]`,
  },
  { name: "openai", pattern: /\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}/g },
  { name: "github", pattern: /\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{16,}/g },
  { name: "aws", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "slack", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { name: "google", pattern: /\bAIza[A-Za-z0-9_-]{20,}/g },
  { name: "jwt", pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g },
  {
    name: "labelled run",
    pattern:
      /((?<![A-Za-z0-9])(?:key|secret|token|password|auth|credential)(?![A-Za-z0-9])[\s\S]{0,20}?)[A-Za-z0-9_+/=-]{32,}/gi,
    replace: (_match, prefix) => `${prefix}[secret hidden]`,
  },
  {
    name: "labelled suffix",
    pattern:
      /[A-Za-z0-9_+/=-]{32,}(?=[\s\S]{0,20}?(?<![A-Za-z0-9])(?:key|secret|token|password|auth|credential)(?![A-Za-z0-9]))/gi,
  },
];
const PLACEHOLDER = /\[(?:secret hidden|credentials|host|ip|email|phone)\]/g;
// Every pass treats prior output as opaque, including owner-provided literal rules.
function outsidePlaceholders(text: string, transform: (segment: string) => string): string {
  return text
    .split(/(\[(?:secret hidden|credentials|host|ip|email|phone)\])/g)
    .map((segment) => (segment.match(PLACEHOLDER) ? segment : transform(segment)))
    .join("");
}
const IPV4 = /(?<![A-Za-z0-9_.])\d{1,3}(?:\.\d{1,3}){3}(?![A-Za-z0-9_]|\.\d|-[a-z])/gi;
const IPV6 =
  /(?<![A-Za-z0-9_.:%[])(?:\[[A-Fa-f0-9:.]+(?:%[A-Za-z0-9_.-]+)?\]|[A-Fa-f0-9]*:[A-Fa-f0-9:.]+(?:%[A-Za-z0-9_.-]+)?(?![A-Za-z0-9_.:%]))/g;
const INTERNAL_HOST =
  /(?<![A-Za-z0-9_.-])(?:(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+(?:ts\.net|local|internal|lan|home\.arpa|localdomain)|localhost)(?![A-Za-z0-9_-]|\.[A-Za-z0-9])/gi;
const LOCAL_PATH =
  /(?<!…)(?:\/(?:Users|home|Volumes|private|tmp)\/|~\/|[A-Za-z]:\\Users\\)[^\s`"'<>\][)]+/g;
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
    hostsMasked: 0,
    pathsCollapsed: 0,
    contactsMasked: 0,
    messagesExcluded: 0,
  };
  const scrub = (input: string): string => {
    let text = input;
    // Literal patterns run first so a partial built-in match cannot defeat an owner rule.
    for (const literal of profile.extraPatterns) {
      if (!literal) continue;
      text = outsidePlaceholders(text, (segment) => {
        const parts = segment.split(literal);
        summary.secretsMasked += parts.length - 1;
        return parts.join("[secret hidden]");
      });
    }
    if (profile.scrub.secrets)
      for (const { pattern, replace } of SECRET_PATTERNS) {
        text = outsidePlaceholders(text, (segment) =>
          segment.replace(pattern, (match: string, prefix: string) => {
            summary.secretsMasked++;
            return replace ? replace(match, prefix) : "[secret hidden]";
          }),
        );
      }
    // An omitted hosts field is the older wire profile, whose default is on.
    if (profile.scrub.hosts !== false) {
      // Leave an email domain for the contact pass to consume the whole address.
      // URL credentials are already opaque, so their host still matches.
      const deferEmailDomain = (segment: string, offset: number) =>
        profile.scrub.contacts &&
        /[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@$/.test(segment.slice(0, offset));
      const maskHost = (marker: "[ip]" | "[host]") => {
        summary.hostsMasked++;
        return marker;
      };
      text = outsidePlaceholders(text, (segment) =>
        segment.replace(IPV6, (value) => {
          const address = value.startsWith("[") ? value.slice(1, -1) : value;
          if (isIP(address) === 6) return maskHost("[ip]");
          // A terminal sentence dot is punctuation, not part of an IPv6 address.
          if (address.endsWith(".") && isIP(address.slice(0, -1)) === 6)
            return `${maskHost("[ip]")}.`;
          return value;
        }),
      );
      text = outsidePlaceholders(text, (segment) =>
        segment.replace(IPV4, (value, offset: number) =>
          !deferEmailDomain(segment, offset) &&
          value.split(".").every((octet) => Number(octet) <= 255)
            ? maskHost("[ip]")
            : value,
        ),
      );
      text = outsidePlaceholders(text, (segment) =>
        segment.replace(INTERNAL_HOST, (value, offset: number) => {
          if (deferEmailDomain(segment, offset)) return value;
          return maskHost("[host]");
        }),
      );
    }
    if (profile.scrub.paths) {
      const collapse = (value: string) => {
        summary.pathsCollapsed++;
        return `…/${value.replaceAll("\\", "/").split("/").filter(Boolean).slice(-2).join("/")}`;
      };
      text = outsidePlaceholders(text, (segment) =>
        segment
          .replace(
            /([`"'])((?:\/(?:Users|home|Volumes|private|tmp)\/|~\/|[A-Za-z]:\\Users\\)[^`"'<>\r\n]+)\1/g,
            (_match, quote: string, value: string) => `${quote}${collapse(value)}${quote}`,
          )
          .replace(LOCAL_PATH, collapse),
      );
    }
    if (profile.scrub.contacts)
      text = outsidePlaceholders(text, (segment) =>
        segment.replace(
          /\b[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+\b|\+[1-9][0-9]{7,14}\b|(?<![\d])(?:\(\d{3}\)|\d{3})[-. ]\d{3}[-. ]\d{4}(?!\d)/g,
          (value) => {
            if (value === metadata.ownerName) return value;
            summary.contactsMasked++;
            return value.includes("@") ? "[email]" : "[phone]";
          },
        ),
      );
    return text;
  };
  const ownerName = scrub(metadata.ownerName);
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
          author: { name: ownerName, role: "owner" },
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
    owner: { name: ownerName },
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
