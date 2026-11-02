import type { Command } from "commander";
import { connectToDaemon } from "../../utils/client.js";
import type {
  CommandError,
  CommandOptions,
  OutputSchema,
  SingleResult,
} from "../../output/index.js";

type CliDaemonClient = Awaited<ReturnType<typeof connectToDaemon>>;
export type QueueInspection = Awaited<ReturnType<CliDaemonClient["inspectAgentDelivery"]>>;

export interface QueueLsOptions extends CommandOptions {
  limit?: string;
}

const DEFAULT_LIMIT = 10;
const NOT_VISIBLE_NOTE =
  "Only what reached this host is shown. A message still saved on a device that has not " +
  "reconnected is invisible here; devices report their unsent counts each time they reconnect.";

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "unknown time";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function preview(text: string | null | undefined): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > 72 ? `${flat.slice(0, 71)}…` : flat || "(no text)";
}

function describeReceipt(state: string): string {
  switch (state) {
    case "completed":
      return "submitted to the agent";
    case "sending":
      return "being submitted now";
    case "pending":
      return "outcome unknown (host stopped mid-submit)";
    case "removed":
      return "removed before delivery";
    default:
      return state;
  }
}

/** Plain-text report: what waits on the host, what was delivered, what devices still hold. */
export function renderQueueInspection(inspection: QueueInspection, limit: number): string {
  const lines: string[] = [];
  const queued = inspection.queue?.items ?? [];
  lines.push(`Agent ${inspection.agentId}`);
  lines.push("");
  lines.push(`Queued on the host, waiting for the agent (${queued.length})`);
  for (const item of queued) {
    lines.push(`  ${item.id}  ${formatTime(item.createdAt)}  ${preview(item.text)}`);
  }
  if (queued.length === 0) lines.push("  none");
  const head = queued[0];
  const headReceipt = head
    ? inspection.receipts.find((receipt) => receipt.messageId === head.id)
    : undefined;
  if (headReceipt?.state === "pending") {
    lines.push(
      `  ! The first message is stuck: its delivery was interrupted, so the queue will not drain on its own.`,
    );
    lines.push(`    Run: paseo agent restart ${inspection.agentId}`);
  }

  lines.push("");
  lines.push(`Recently delivered from the queue (newest first, ${limit} max)`);
  const drained = inspection.drained.slice(0, limit);
  for (const item of drained) {
    lines.push(`  ${item.id}  ${formatTime(item.drainedAt)}  ${preview(item.preview)}`);
  }
  if (drained.length === 0) lines.push("  none recorded");

  lines.push("");
  lines.push(`Delivery receipts (direct sends and queue drains, newest first, ${limit} max)`);
  const receipts = inspection.receipts.slice(0, limit);
  for (const receipt of receipts) {
    lines.push(
      `  ${receipt.messageId}  ${formatTime(receipt.createdAt)}  ${describeReceipt(receipt.state)}`,
    );
  }
  if (receipts.length === 0) lines.push("  none");

  lines.push("");
  const holding = inspection.deviceReports.filter(
    (report) => report.unsentQueued + report.unsentDirect > 0,
  );
  lines.push(`Devices reporting unsent messages for this agent (${holding.length})`);
  for (const report of holding) {
    const label = report.deviceLabel ?? report.platform ?? report.clientId.slice(0, 8);
    const oldest = report.oldestCreatedAt ? `, oldest ${formatTime(report.oldestCreatedAt)}` : "";
    lines.push(
      `  ${label}: ${report.unsentQueued} queued + ${report.unsentDirect} direct unsent` +
        `${oldest} (reported ${formatTime(report.reportedAt)})`,
    );
  }
  const clear = inspection.deviceReports.length - holding.length;
  if (clear > 0) lines.push(`  ${clear} other device(s) reported nothing unsent for this agent`);
  if (inspection.deviceReports.length === 0)
    lines.push("  no device has reported since the host started");

  lines.push("");
  lines.push(NOT_VISIBLE_NOTE);
  return lines.join("\n");
}

function inspectionSchema(limit: number): OutputSchema<QueueInspection> {
  return {
    idField: "agentId",
    columns: [{ header: "AGENT", field: "agentId" }],
    renderHuman: (result) =>
      result.type === "single" ? renderQueueInspection(result.data, limit) : "",
    serialize: (data) => ({ ...data, note: NOT_VISIBLE_NOTE }),
  };
}

export async function runQueueLsCommand(
  agentId: string,
  options: QueueLsOptions,
  _command: Command,
): Promise<SingleResult<QueueInspection>> {
  const limit = Math.max(1, Number.parseInt(options.limit ?? "", 10) || DEFAULT_LIMIT);
  const client = await connectToDaemon({ target: options.daemonTarget });
  try {
    // COMPAT(deliveryInspect): fork feature, added in fork v0.10.0-beta.15, remove gate after 2027-04-22.
    if (client.getLastServerInfoMessage()?.features?.deliveryInspect !== true) {
      const error: CommandError = {
        code: "HOST_UPDATE_REQUIRED",
        message: "Update the host to use this: it does not report message delivery state.",
      };
      throw error;
    }
    const inspection = await client.inspectAgentDelivery(agentId);
    return { type: "single", data: inspection, schema: inspectionSchema(limit) };
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && "message" in err) throw err;
    const error: CommandError = {
      code: "QUEUE_INSPECT_FAILED",
      message: `Failed to inspect message delivery: ${err instanceof Error ? err.message : String(err)}`,
    };
    throw error;
  } finally {
    await client.close().catch(() => {});
  }
}
