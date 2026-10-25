import { readFileSync } from "node:fs";
import path from "node:path";
import type { Logger } from "pino";
import {
  redactDiagnosticField,
  redactDiagnosticText,
  StoredClientDiagnosticSchema,
  type ClientDiagnosticEvent,
  type ClientDiagnosticSource,
  type StoredClientDiagnostic,
} from "@getpaseo/protocol/client-diagnostics";
import { writeJsonFileAtomic } from "../atomic-file.js";

export interface ClientDiagnosticsLimits {
  /** Newest diagnostics kept; older ones are dropped first. */
  maxEvents: number;
  /** Diagnostics older than this are dropped. */
  maxAgeMs: number;
  /** Serialized size cap for the persisted file. */
  maxBytes: number;
  /** New diagnostics accepted per reporter within `rateWindowMs`; the rest are deferred. */
  maxPerWindow: number;
  rateWindowMs: number;
  /** Delay before persisting a change, so bursts write once. */
  persistDelayMs: number;
}

export const DEFAULT_CLIENT_DIAGNOSTICS_LIMITS: ClientDiagnosticsLimits = {
  maxEvents: 1000,
  maxAgeMs: 14 * 24 * 60 * 60 * 1000,
  maxBytes: 1024 * 1024,
  maxPerWindow: 120,
  rateWindowMs: 10 * 60 * 1000,
  persistDelayMs: 1000,
};

export interface ClientDiagnosticsReporter {
  clientId: string | null;
  deviceLabel: string | null;
  platform: string | null;
  /** The reporting connection's app version, used when an event does not carry its own. */
  appVersion: string | null;
}

export interface ClientDiagnosticsRecordResult {
  acknowledgedIds: string[];
  deferredIds: string[];
}

export interface HostDiagnosticInput {
  message: string;
  severity?: "error" | "warning";
  code?: string;
  operation?: string;
  phase?: string;
  agentId?: string;
  clientId?: string | null;
}

interface PersistedFile {
  version: 1;
  events: StoredClientDiagnostic[];
}

function timeOf(iso: string | undefined): number {
  const value = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(value) ? value : 0;
}

/**
 * Host-side record of the errors devices saw, plus the host's own GPT Realtime failures.
 * Bounded by count, age, serialized size and a per-reporter rate limit; each new diagnostic is
 * also written once to the daemon log at warn level. Persisted under PASEO_HOME so a daemon
 * restart keeps recent history.
 */
export class ClientDiagnosticsStore {
  private events: StoredClientDiagnostic[] = [];
  private readonly windows = new Map<string, number[]>();
  private rateLimited = 0;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private persistTail: Promise<void> = Promise.resolve();
  private readonly filePath: string;

  constructor(
    directory: string,
    private readonly logger: Logger,
    private readonly limits: ClientDiagnosticsLimits = DEFAULT_CLIENT_DIAGNOSTICS_LIMITS,
    private readonly now: () => number = Date.now,
  ) {
    this.filePath = path.join(directory, "client-errors.json");
    this.events = this.load();
    this.prune();
  }

  get retention(): { maxEvents: number; maxAgeDays: number } {
    return {
      maxEvents: this.limits.maxEvents,
      maxAgeDays: this.limits.maxAgeMs / (24 * 60 * 60 * 1000),
    };
  }

  get rateLimitedCount(): number {
    return this.rateLimited;
  }

  /** Records a device's batch. Repeats of an id merge (count, last occurrence) instead of adding. */
  record(
    reporter: ClientDiagnosticsReporter,
    events: readonly ClientDiagnosticEvent[],
  ): ClientDiagnosticsRecordResult {
    const acknowledgedIds: string[] = [];
    const deferredIds: string[] = [];
    let changed = false;
    for (const raw of events) {
      const existing = this.events.find(
        (event) => event.id === raw.id && event.clientId === reporter.clientId,
      );
      if (existing) {
        if (raw.count > existing.count) {
          existing.count = raw.count;
          existing.lastOccurredAt = raw.lastOccurredAt ?? existing.lastOccurredAt;
          changed = true;
        }
        acknowledgedIds.push(raw.id);
        continue;
      }
      if (!this.admit(reporter.clientId ?? "unknown")) {
        this.rateLimited += 1;
        deferredIds.push(raw.id);
        continue;
      }
      const stored = this.sanitize(raw, reporter);
      this.events.push(stored);
      this.log(stored);
      acknowledgedIds.push(raw.id);
      changed = true;
    }
    if (changed) this.changed();
    return { acknowledgedIds, deferredIds };
  }

  /** Records a failure the host observed itself, e.g. GPT Realtime rejecting an event. */
  recordHost(input: HostDiagnosticInput): void {
    if (!this.admit("host")) {
      this.rateLimited += 1;
      return;
    }
    const at = new Date(this.now()).toISOString();
    const stored = this.sanitize(
      {
        id: `host-${this.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
        occurredAt: at,
        count: 1,
        source: "host-voice",
        severity: input.severity ?? "error",
        message: input.message,
        code: input.code,
        operation: input.operation,
        phase: input.phase,
        agentId: input.agentId,
      },
      { clientId: input.clientId ?? null, deviceLabel: null, platform: null, appVersion: null },
    );
    this.events.push(stored);
    this.log(stored);
    this.changed();
  }

  /** Newest first. */
  list(
    options: { limit?: number; since?: string; source?: ClientDiagnosticSource } = {},
  ): StoredClientDiagnostic[] {
    this.prune();
    const since = options.since ? timeOf(options.since) : 0;
    // Ties (same occurrence time) fall back to arrival order, later first.
    return this.events
      .map((event, arrival) => ({ event, arrival }))
      .filter(({ event }) => (options.source ? event.source === options.source : true))
      .filter(({ event }) => timeOf(event.lastOccurredAt ?? event.occurredAt) >= since)
      .sort(
        (a, b) =>
          timeOf(b.event.lastOccurredAt ?? b.event.occurredAt) -
            timeOf(a.event.lastOccurredAt ?? a.event.occurredAt) || b.arrival - a.arrival,
      )
      .slice(0, options.limit ?? 100)
      .map(({ event }) => event);
  }

  /** Writes any pending change now. */
  async flush(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
      this.persist();
    }
    await this.persistTail;
  }

  private sanitize(
    raw: ClientDiagnosticEvent,
    reporter: ClientDiagnosticsReporter,
  ): StoredClientDiagnostic {
    const appVersion = redactDiagnosticField(raw.appVersion ?? reporter.appVersion ?? undefined);
    return {
      id: raw.id,
      occurredAt: raw.occurredAt,
      ...(raw.lastOccurredAt ? { lastOccurredAt: raw.lastOccurredAt } : {}),
      count: raw.count,
      source: raw.source,
      severity: raw.severity,
      message: redactDiagnosticText(raw.message) || "(no message)",
      ...optional("code", redactDiagnosticField(raw.code)),
      ...optional("operation", redactDiagnosticField(raw.operation)),
      ...optional("phase", redactDiagnosticField(raw.phase)),
      ...optional("agentId", redactDiagnosticField(raw.agentId)),
      ...optional("appVersion", appVersion),
      receivedAt: new Date(this.now()).toISOString(),
      clientId: reporter.clientId,
      deviceLabel: redactDiagnosticField(reporter.deviceLabel ?? undefined) ?? null,
      platform: redactDiagnosticField(reporter.platform ?? undefined) ?? null,
    };
  }

  private admit(reporterKey: string): boolean {
    const now = this.now();
    const window = (this.windows.get(reporterKey) ?? []).filter(
      (at) => now - at < this.limits.rateWindowMs,
    );
    if (window.length >= this.limits.maxPerWindow) {
      this.windows.set(reporterKey, window);
      return false;
    }
    window.push(now);
    this.windows.set(reporterKey, window);
    return true;
  }

  private log(event: StoredClientDiagnostic): void {
    this.logger.warn(
      {
        diagnosticId: event.id,
        source: event.source,
        severity: event.severity,
        code: event.code,
        operation: event.operation,
        phase: event.phase,
        agentId: event.agentId,
        appVersion: event.appVersion,
        platform: event.platform,
        deviceLabel: event.deviceLabel,
        clientId: event.clientId,
        occurredAt: event.occurredAt,
        count: event.count,
        diagnosticMessage: event.message,
      },
      event.source === "host-voice" ? "host_voice_diagnostic" : "client_diagnostic_reported",
    );
  }

  private prune(): void {
    const cutoff = this.now() - this.limits.maxAgeMs;
    this.events = this.events
      .filter((event) => timeOf(event.lastOccurredAt ?? event.occurredAt) >= cutoff)
      .sort((a, b) => timeOf(a.receivedAt) - timeOf(b.receivedAt));
    if (this.events.length > this.limits.maxEvents) {
      this.events = this.events.slice(this.events.length - this.limits.maxEvents);
    }
    while (
      this.events.length > 0 &&
      Buffer.byteLength(JSON.stringify(this.events)) > this.limits.maxBytes
    ) {
      this.events.shift();
    }
  }

  private changed(): void {
    this.prune();
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persist();
    }, this.limits.persistDelayMs);
    (this.persistTimer as unknown as { unref?: () => void }).unref?.();
  }

  private persist(): void {
    const snapshot: PersistedFile = { version: 1, events: [...this.events] };
    this.persistTail = this.persistTail
      .then(() => writeJsonFileAtomic(this.filePath, snapshot))
      .catch((error) => this.logger.warn({ err: error }, "Failed to persist client diagnostics"));
  }

  private load(): StoredClientDiagnostic[] {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<PersistedFile>;
      if (!Array.isArray(parsed.events)) return [];
      return parsed.events.flatMap((event) => {
        const result = StoredClientDiagnosticSchema.safeParse(event);
        return result.success ? [result.data] : [];
      });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        this.logger.warn({ err: error }, "Ignoring unreadable client diagnostics file");
      }
      return [];
    }
  }
}

function optional<K extends string>(key: K, value: string | undefined): Partial<Record<K, string>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, string>);
}
