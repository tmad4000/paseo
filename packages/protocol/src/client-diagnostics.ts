import { z } from "zod";

/**
 * Client error diagnostics: user-visible errors a device saw (toasts, voice failures, failed host
 * requests, uncaught errors) reported to the host, plus host-side GPT Realtime failures, so an
 * agent can read what the person actually saw. See docs/client-error-diagnostics.md.
 *
 * These are metadata, never content: no request bodies, transcripts, audio, prompts or
 * credentials. Every text field passes through `redactDiagnosticText` on both sides.
 */

export const CLIENT_DIAGNOSTIC_MESSAGE_MAX = 500;
export const CLIENT_DIAGNOSTIC_FIELD_MAX = 120;
/** Upper bound on events in one report request; devices send larger backlogs in batches. */
export const CLIENT_DIAGNOSTIC_BATCH_MAX = 50;

export const ClientDiagnosticSourceSchema = z.enum([
  /** An error or warning toast the person saw. */
  "toast",
  /** A voice failure the client surfaced (failure cue, microphone lost, realtime state error). */
  "voice",
  /** A host request that came back as an error or timed out. */
  "rpc",
  /** An uncaught error or unhandled rejection. */
  "global",
  /** Recorded by the host itself: a GPT Realtime failure before it was forwarded to the device. */
  "host-voice",
]);
export type ClientDiagnosticSource = z.infer<typeof ClientDiagnosticSourceSchema>;

export const ClientDiagnosticSeveritySchema = z.enum(["error", "warning"]);
export type ClientDiagnosticSeverity = z.infer<typeof ClientDiagnosticSeveritySchema>;

const shortField = z.string().max(CLIENT_DIAGNOSTIC_FIELD_MAX);

/** One diagnostic as a device reports it. `id` is stable across retries so the host can dedupe. */
export const ClientDiagnosticEventSchema = z.object({
  id: z.string().min(1).max(80),
  occurredAt: z.string().max(40),
  /** Set when the device coalesced repeats of the same diagnostic into this one. */
  lastOccurredAt: z.string().max(40).optional(),
  count: z.number().int().min(1).max(1_000_000),
  source: ClientDiagnosticSourceSchema,
  severity: ClientDiagnosticSeveritySchema,
  message: z.string().max(CLIENT_DIAGNOSTIC_MESSAGE_MAX * 2),
  /** Machine-readable cause, e.g. an OpenAI error code or a voice failure kind. */
  code: shortField.optional(),
  /** What was being done, e.g. a request type or a realtime event type. */
  operation: shortField.optional(),
  /** Where in the flow it happened, e.g. "starting", "connected", "reconnecting". */
  phase: shortField.optional(),
  agentId: shortField.optional(),
  appVersion: shortField.optional(),
});
export type ClientDiagnosticEvent = z.infer<typeof ClientDiagnosticEventSchema>;

/** A diagnostic as the host stores it and returns it to readers. */
export const StoredClientDiagnosticSchema = ClientDiagnosticEventSchema.extend({
  receivedAt: z.string(),
  clientId: z.string().nullable(),
  deviceLabel: z.string().nullable(),
  platform: z.string().nullable(),
});
export type StoredClientDiagnostic = z.infer<typeof StoredClientDiagnosticSchema>;

const TRUNCATION_MARK = "…";

const REDACTIONS: ReadonlyArray<[RegExp, string]> = [
  // Authorization headers and bearer tokens.
  [/\b(authorization|proxy-authorization)\s*[:=]\s*\S+(\s+\S+)?/gi, "$1: [redacted]"],
  [/\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]"],
  // Provider API keys (OpenAI-style, GitHub, Slack, generic long key prefixes).
  [/\b(sk|rk|pk)-[A-Za-z0-9_-]{8,}/g, "[redacted-key]"],
  [/\b(ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{12,}/g, "[redacted-key]"],
  [/\bxox[abprs]-[A-Za-z0-9-]{8,}/g, "[redacted-key]"],
  // JWTs.
  [/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g, "[redacted-jwt]"],
  // key=value / key: value secrets.
  [
    /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd|credential|session[_-]?key)(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&]+)/gi,
    "$1$2[redacted]",
  ],
  // Secret-bearing URL query parameters.
  [/([?&](?:token|key|code|sig|signature|auth|password|secret)=)[^&\s#]+/gi, "$1[redacted]"],
  // Long base64/hex runs: encoded audio, images, keys or blobs, never useful to a reader.
  [/[A-Za-z0-9+/_-]{64,}={0,2}/g, "[redacted-blob]"],
];

/**
 * Keeps the readable part of an error message and removes credentials and encoded payloads.
 * It is a best-effort filter, not a guarantee: callers must still never pass content (prompts,
 * transcripts, request bodies) as a diagnostic message.
 */
export function redactDiagnosticText(
  value: unknown,
  max: number = CLIENT_DIAGNOSTIC_MESSAGE_MAX,
): string {
  let text = "";
  if (typeof value === "string") text = value;
  else if (value instanceof Error) text = value.message;
  for (const [pattern, replacement] of REDACTIONS) text = text.replace(pattern, replacement);
  text = text.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}${TRUNCATION_MARK}` : text;
}

/** Normalizes a free-form field (code, operation, phase) to a short, redacted token. */
export function redactDiagnosticField(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const text = redactDiagnosticText(String(value), CLIENT_DIAGNOSTIC_FIELD_MAX);
  return text.length > 0 ? text : undefined;
}

/**
 * Two diagnostics with the same fingerprint are the same problem repeating; devices coalesce them
 * into one event with a count. Numbers are ignored so "retry 3" and "retry 4" match.
 */
export function diagnosticFingerprint(
  event: Pick<ClientDiagnosticEvent, "source" | "severity" | "message" | "code" | "operation">,
): string {
  const normalized = event.message.toLowerCase().replace(/\d+/g, "#");
  return [event.source, event.severity, event.code ?? "", event.operation ?? "", normalized].join(
    "\u0000",
  );
}

export const ClientDiagnosticsReportRequestSchema = z.object({
  type: z.literal("client.diagnostics.report.request"),
  requestId: z.string(),
  deviceLabel: z.string().max(CLIENT_DIAGNOSTIC_FIELD_MAX).optional(),
  platform: z.string().max(CLIENT_DIAGNOSTIC_FIELD_MAX).optional(),
  events: z.array(ClientDiagnosticEventSchema).max(CLIENT_DIAGNOSTIC_BATCH_MAX),
});

export const ClientDiagnosticsReportResponseSchema = z.object({
  type: z.literal("client.diagnostics.report.response"),
  payload: z.object({
    requestId: z.string(),
    /** Ids the host now holds (new or merged). The device may forget these. */
    acknowledgedIds: z.array(z.string()),
    /** Ids refused by the host's rate limit; the device keeps and retries them later. */
    deferredIds: z.array(z.string()),
    error: z.string().nullable(),
  }),
});

export const ClientDiagnosticsListRequestSchema = z.object({
  type: z.literal("client.diagnostics.list.request"),
  requestId: z.string(),
  limit: z.number().int().min(1).max(1000).optional(),
  /** ISO timestamp; only diagnostics that occurred at or after it. */
  since: z.string().optional(),
  source: ClientDiagnosticSourceSchema.optional(),
});

export const ClientDiagnosticsListResponseSchema = z.object({
  type: z.literal("client.diagnostics.list.response"),
  payload: z.object({
    requestId: z.string(),
    /** Newest first. */
    events: z.array(StoredClientDiagnosticSchema),
    /** How many reported diagnostics the host refused for rate limiting since it started. */
    rateLimited: z.number().int().nonnegative(),
    retention: z.object({
      maxEvents: z.number().int().positive(),
      maxAgeDays: z.number().positive(),
    }),
    error: z.string().nullable(),
  }),
});
