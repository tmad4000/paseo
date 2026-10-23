import { z } from "zod";
import {
  CLIENT_DIAGNOSTIC_BATCH_MAX,
  ClientDiagnosticEventSchema,
  diagnosticFingerprint,
  redactDiagnosticField,
  redactDiagnosticText,
  type ClientDiagnosticEvent,
  type ClientDiagnosticSeverity,
  type ClientDiagnosticSource,
} from "@getpaseo/protocol/client-diagnostics";

/** Most diagnostics kept on the device while waiting for a host. Oldest are dropped first. */
export const CLIENT_DIAGNOSTICS_MAX_PENDING = 200;
/** Diagnostics older than this are dropped from the device even if never delivered. */
export const CLIENT_DIAGNOSTICS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Repeats of the same diagnostic within this window are counted on one event. */
export const CLIENT_DIAGNOSTICS_COALESCE_MS = 10 * 60 * 1000;

export const PendingClientDiagnosticSchema = ClientDiagnosticEventSchema.extend({
  fingerprint: z.string(),
  /** Host the diagnostic belongs to; absent means any host may take it. */
  serverId: z.string().optional(),
  /**
   * Host currently sending an unassigned diagnostic. While set, no other host takes it; released
   * if that host does not acknowledge it, and cleared on restart (no send survives a restart).
   */
  claimedBy: z.string().optional(),
  lastSeenMs: z.number(),
});
export type PendingClientDiagnostic = z.infer<typeof PendingClientDiagnosticSchema>;

export interface ClientDiagnosticInput {
  source: ClientDiagnosticSource;
  severity?: ClientDiagnosticSeverity;
  message: unknown;
  code?: unknown;
  operation?: unknown;
  phase?: unknown;
  agentId?: string | null;
  serverId?: string | null;
  appVersion?: string | null;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * Adds one diagnostic to the device queue: redacts it, folds it into a recent identical one, and
 * keeps the queue within its count and age bounds. Pure; returns the new queue.
 */
export function addClientDiagnostic(
  entries: readonly PendingClientDiagnostic[],
  input: ClientDiagnosticInput,
  options: { now: number; createId: () => string },
): PendingClientDiagnostic[] {
  const message = redactDiagnosticText(input.message) || "(no message)";
  const event = {
    source: input.source,
    severity: input.severity ?? "error",
    message,
    code: redactDiagnosticField(input.code),
    operation: redactDiagnosticField(input.operation),
  };
  const fingerprint = diagnosticFingerprint(event);
  const serverId = input.serverId ?? undefined;
  const phase = redactDiagnosticField(input.phase);
  const agentId = redactDiagnosticField(input.agentId ?? undefined);
  const next = pruneExpiredClientDiagnostics(entries, options.now);
  // A repeat is the same problem in the same context: the same message in another chat or phase
  // is a separate diagnostic, so a count never misattributes failures to the first chat.
  const repeat = next.find(
    (entry) =>
      entry.fingerprint === fingerprint &&
      entry.serverId === serverId &&
      entry.agentId === agentId &&
      entry.phase === phase &&
      options.now - entry.lastSeenMs < CLIENT_DIAGNOSTICS_COALESCE_MS,
  );
  if (repeat) {
    return next.map((entry) =>
      entry === repeat
        ? {
            ...entry,
            count: entry.count + 1,
            lastOccurredAt: iso(options.now),
            lastSeenMs: options.now,
          }
        : entry,
    );
  }
  const created: PendingClientDiagnostic = {
    id: options.createId(),
    occurredAt: iso(options.now),
    count: 1,
    ...event,
    ...optional("phase", phase),
    ...optional("agentId", agentId),
    ...optional("appVersion", redactDiagnosticField(input.appVersion ?? undefined)),
    fingerprint,
    ...(serverId ? { serverId } : {}),
    lastSeenMs: options.now,
  };
  const withNew = [...next, stripUndefined(created)];
  if (withNew.length <= CLIENT_DIAGNOSTICS_MAX_PENDING) return withNew;
  return [...withNew]
    .sort((a, b) => a.lastSeenMs - b.lastSeenMs)
    .slice(withNew.length - CLIENT_DIAGNOSTICS_MAX_PENDING);
}

/** Drops diagnostics past the device age limit. Applied on add, on load and before sending. */
export function pruneExpiredClientDiagnostics(
  entries: readonly PendingClientDiagnostic[],
  now: number,
): PendingClientDiagnostic[] {
  return entries.filter((entry) => now - entry.lastSeenMs < CLIENT_DIAGNOSTICS_MAX_AGE_MS);
}

/**
 * Diagnostics this host should receive now, oldest first, at most one report's worth: its own,
 * plus unassigned ones no other host has claimed. Expired ones are never sent.
 */
export function selectClientDiagnosticBatch(
  entries: readonly PendingClientDiagnostic[],
  serverId: string,
  now: number,
): PendingClientDiagnostic[] {
  return pruneExpiredClientDiagnostics(entries, now)
    .filter((entry) =>
      entry.serverId === undefined
        ? entry.claimedBy === undefined || entry.claimedBy === serverId
        : entry.serverId === serverId,
    )
    .sort((a, b) => a.lastSeenMs - b.lastSeenMs)
    .slice(0, CLIENT_DIAGNOSTIC_BATCH_MAX);
}

/** Marks the unassigned diagnostics in `sent` as being sent to `serverId`. */
export function claimClientDiagnostics(
  entries: readonly PendingClientDiagnostic[],
  sent: readonly PendingClientDiagnostic[],
  serverId: string,
): PendingClientDiagnostic[] {
  const ids = new Set(
    sent.filter((entry) => entry.serverId === undefined).map((entry) => entry.id),
  );
  return entries.map((entry) => (ids.has(entry.id) ? { ...entry, claimedBy: serverId } : entry));
}

/** Makes claimed diagnostics available to any host again (not acknowledged, or after restart). */
export function releaseClientDiagnosticClaims(
  entries: readonly PendingClientDiagnostic[],
  ids?: ReadonlySet<string>,
): PendingClientDiagnostic[] {
  return entries.map((entry) => {
    if (entry.claimedBy === undefined || (ids && !ids.has(entry.id))) return entry;
    const { claimedBy: _claimedBy, ...released } = entry;
    return released;
  });
}

/** The wire form of a queued diagnostic: device-only bookkeeping removed. */
export function toWireDiagnostic(entry: PendingClientDiagnostic): ClientDiagnosticEvent {
  const {
    fingerprint: _fingerprint,
    serverId: _serverId,
    claimedBy: _claimedBy,
    lastSeenMs: _lastSeenMs,
    ...wire
  } = entry;
  return wire;
}

/**
 * Forgets what the host acknowledged. An entry that gained repeats after it was sent stays, so its
 * higher count is reported again under the same id (the host merges it).
 */
export function applyClientDiagnosticAck(
  entries: readonly PendingClientDiagnostic[],
  sent: readonly PendingClientDiagnostic[],
  acknowledgedIds: readonly string[],
): PendingClientDiagnostic[] {
  const acked = new Set(acknowledgedIds);
  const sentCounts = new Map(sent.map((entry) => [entry.id, entry.count]));
  return entries.filter((entry) => {
    if (!acked.has(entry.id)) return true;
    return entry.count > (sentCounts.get(entry.id) ?? entry.count);
  });
}

function optional<K extends string>(key: K, value: string | undefined): Partial<Record<K, string>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, string>);
}

function stripUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}
