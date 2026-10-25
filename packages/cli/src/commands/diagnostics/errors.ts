import type { Command } from "commander";
import { connectToDaemon } from "../../utils/client.js";
import type {
  CommandError,
  CommandOptions,
  OutputSchema,
  SingleResult,
} from "../../output/index.js";

type CliDaemonClient = Awaited<ReturnType<typeof connectToDaemon>>;
export type ClientDiagnosticsListing = Awaited<
  ReturnType<CliDaemonClient["listClientDiagnostics"]>
>;

export interface DiagnosticsErrorsOptions extends CommandOptions {
  limit?: string;
  since?: string;
  source?: string;
}

const SOURCES = ["toast", "voice", "rpc", "global", "host-voice"] as const;
type Source = (typeof SOURCES)[number];
const DEFAULT_LIMIT = 50;
const UNIT_MS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000 };

export const DIAGNOSTICS_COVERAGE_NOTE =
  "Shows errors devices reported (toasts, voice failures, failed host requests, uncaught errors) " +
  "and GPT Realtime failures the host recorded itself. Devices send what they saw when they next " +
  "reach this host; native crashes, errors from before this feature, and anything a device never " +
  "reconnects to report are not here.";

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "unknown time";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/** Parses "30m", "2h", "1d" or an ISO timestamp into an ISO lower bound. */
export function parseSince(value: string | undefined, now = Date.now()): string | undefined {
  if (!value) return undefined;
  const relative = /^(\d+)\s*([mhd])$/i.exec(value.trim());
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2].toLowerCase();
    const ms = UNIT_MS[unit] ?? 86_400_000;
    return new Date(now - amount * ms).toISOString();
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    const error: CommandError = {
      code: "INVALID_SINCE",
      message: `--since must be like 30m, 2h, 1d or an ISO timestamp, got "${value}"`,
    };
    throw error;
  }
  return new Date(parsed).toISOString();
}

/** Plain-text report, newest first, one block per diagnostic. */
export function renderClientDiagnostics(listing: ClientDiagnosticsListing): string {
  const lines: string[] = [];
  lines.push(`Client and voice diagnostics (${listing.events.length}, newest first)`);
  for (const event of listing.events) {
    const when = formatTime(event.lastOccurredAt ?? event.occurredAt);
    const repeat = event.count > 1 ? ` x${event.count} since ${formatTime(event.occurredAt)}` : "";
    const device =
      event.source === "host-voice"
        ? "host"
        : (event.deviceLabel ?? event.platform ?? event.clientId?.slice(0, 8) ?? "unknown device");
    const meta = [
      event.code ? `code=${event.code}` : null,
      event.operation ? `op=${event.operation}` : null,
      event.phase ? `phase=${event.phase}` : null,
      event.agentId ? `agent=${event.agentId.slice(0, 8)}` : null,
      event.appVersion ? `app=${event.appVersion}` : null,
    ]
      .filter(Boolean)
      .join(" ");
    lines.push("");
    lines.push(`${when}${repeat}  [${event.source} ${event.severity}] ${device}`);
    lines.push(`  ${event.message}`);
    if (meta) lines.push(`  ${meta}`);
  }
  if (listing.events.length === 0) lines.push("  none recorded");
  lines.push("");
  if (listing.rateLimited > 0) {
    lines.push(`${listing.rateLimited} reported diagnostic(s) were deferred by the rate limit.`);
  }
  lines.push(
    `Retention: newest ${listing.retention.maxEvents}, up to ${listing.retention.maxAgeDays} days.`,
  );
  lines.push(DIAGNOSTICS_COVERAGE_NOTE);
  return lines.join("\n");
}

function listingSchema(): OutputSchema<ClientDiagnosticsListing> {
  return {
    idField: "requestId",
    columns: [{ header: "REQUEST", field: "requestId" }],
    renderHuman: (result) => (result.type === "single" ? renderClientDiagnostics(result.data) : ""),
    serialize: (data) => ({ ...data, note: DIAGNOSTICS_COVERAGE_NOTE }),
  };
}

export async function runDiagnosticsErrorsCommand(
  options: DiagnosticsErrorsOptions,
  _command: Command,
): Promise<SingleResult<ClientDiagnosticsListing>> {
  const limit = Math.min(
    1000,
    Math.max(1, Number.parseInt(options.limit ?? "", 10) || DEFAULT_LIMIT),
  );
  const since = parseSince(options.since);
  let source: Source | undefined;
  if (options.source !== undefined) {
    if (!(SOURCES as readonly string[]).includes(options.source)) {
      const error: CommandError = {
        code: "INVALID_SOURCE",
        message: `--source must be one of ${SOURCES.join(", ")}`,
      };
      throw error;
    }
    source = options.source as Source;
  }
  const client = await connectToDaemon({ target: options.daemonTarget });
  try {
    // COMPAT(clientDiagnostics): fork feature, added in fork v0.10.0-beta.16, remove gate after 2027-04-23.
    if (client.getLastServerInfoMessage()?.features?.clientDiagnostics !== true) {
      const error: CommandError = {
        code: "HOST_UPDATE_REQUIRED",
        message: "Update the host to use this: it does not record client diagnostics.",
      };
      throw error;
    }
    const listing = await client.listClientDiagnostics({ limit, since, source });
    return { type: "single", data: listing, schema: listingSchema() };
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && "message" in err) throw err;
    const error: CommandError = {
      code: "DIAGNOSTICS_LIST_FAILED",
      message: `Failed to read client diagnostics: ${err instanceof Error ? err.message : String(err)}`,
    };
    throw error;
  } finally {
    await client.close().catch(() => {});
  }
}
