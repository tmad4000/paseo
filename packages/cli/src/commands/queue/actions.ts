import type { Command } from "commander";
import { connectToDaemon } from "../../utils/client.js";
import type {
  CommandError,
  CommandOptions,
  OutputSchema,
  SingleResult,
} from "../../output/index.js";

type CliDaemonClient = Awaited<ReturnType<typeof connectToDaemon>>;

export interface QueueActionResult {
  agentId: string;
  action: string;
  queued: number;
  detail: string;
}

const actionSchema: OutputSchema<QueueActionResult> = {
  idField: "agentId",
  columns: [
    { header: "AGENT", field: "agentId" },
    { header: "ACTION", field: "action" },
    { header: "QUEUED", field: "queued" },
    { header: "DETAIL", field: "detail" },
  ],
};

async function withQueueClient(
  options: CommandOptions,
  failureCode: string,
  run: (client: CliDaemonClient) => Promise<QueueActionResult>,
): Promise<SingleResult<QueueActionResult>> {
  const client = await connectToDaemon({ target: options.daemonTarget });
  try {
    const data = await run(client);
    return { type: "single", data, schema: actionSchema };
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && "message" in err) throw err;
    const error: CommandError = {
      code: failureCode,
      message: err instanceof Error ? err.message : String(err),
    };
    throw error;
  } finally {
    await client.close().catch(() => {});
  }
}

function requireFeature(client: CliDaemonClient, feature: "queueDrain" | "queueSendNow"): void {
  // COMPAT(queueDrain): fork feature. Remove gate after 2027-05-01.
  if (client.getLastServerInfoMessage()?.features?.[feature] !== true) {
    const error: CommandError = {
      code: "HOST_UPDATE_REQUIRED",
      message: "Update the host to use this.",
    };
    throw error;
  }
}

export function runQueueDrainCommand(
  agentId: string,
  options: CommandOptions,
  _command: Command,
): Promise<SingleResult<QueueActionResult>> {
  return withQueueClient(options, "QUEUE_DRAIN_FAILED", async (client) => {
    requireFeature(client, "queueDrain");
    const before = (await client.listQueuedAgentMessages(agentId)).items.length;
    const queue = await client.drainAgentQueue(agentId);
    return {
      agentId,
      action: "drain",
      queued: queue.items.length,
      detail:
        before === queue.items.length && before > 0
          ? "nothing sent: agent busy, waiting on a permission, or head stuck (try: paseo agent restart)"
          : `${before - queue.items.length} sent now; the rest follow one per turn`,
    };
  });
}

export function runQueueClearCommand(
  agentId: string,
  options: CommandOptions,
  _command: Command,
): Promise<SingleResult<QueueActionResult>> {
  return withQueueClient(options, "QUEUE_CLEAR_FAILED", async (client) => {
    requireFeature(client, "queueDrain");
    const result = await client.clearAgentQueue(agentId);
    return {
      agentId,
      action: "clear",
      queued: result.queue?.items.length ?? 0,
      detail: `${result.removed ?? 0} removed, ${result.kept ?? 0} kept (already being submitted)`,
    };
  });
}

export function runQueueSendNowCommand(
  agentId: string,
  itemId: string,
  options: CommandOptions,
  _command: Command,
): Promise<SingleResult<QueueActionResult>> {
  return withQueueClient(options, "QUEUE_SEND_NOW_FAILED", async (client) => {
    requireFeature(client, "queueSendNow");
    const queue = await client.sendQueuedAgentMessageNow(agentId, itemId);
    return { agentId, action: "send-now", queued: queue.items.length, detail: itemId };
  });
}

export function runQueueRemoveCommand(
  agentId: string,
  itemId: string,
  options: CommandOptions,
  _command: Command,
): Promise<SingleResult<QueueActionResult>> {
  return withQueueClient(options, "QUEUE_REMOVE_FAILED", async (client) => {
    const queue = await client.removeQueuedAgentMessage(agentId, itemId);
    return { agentId, action: "rm", queued: queue.items.length, detail: itemId };
  });
}
