import type { Command } from "commander";
import { connectToDaemon, resolveAgentId } from "../../utils/client.js";
import type {
  CommandError,
  CommandOptions,
  OutputSchema,
  SingleResult,
} from "../../output/index.js";

export interface AgentRestartResult {
  agentId: string;
  mode: string;
  timelineSize: number;
  queuedBefore: number | null;
  queuedAfter: number | null;
  recoveredHead: string;
}

export const restartSchema: OutputSchema<AgentRestartResult> = {
  idField: "agentId",
  columns: [
    { header: "AGENT ID", field: "agentId" },
    { header: "MODE", field: "mode" },
    { header: "TIMELINE", field: "timelineSize" },
    { header: "QUEUED BEFORE", field: "queuedBefore" },
    { header: "QUEUED AFTER", field: "queuedAfter" },
    { header: "STUCK HEAD", field: "recoveredHead" },
  ],
};

export function addRestartOptions(cmd: Command): Command {
  return cmd
    .description(
      "Restart an agent: restart its provider process, resume the same session, and deliver its queued messages in order",
    )
    .argument("<id>", "Agent ID, prefix, or name");
}

export async function runRestartCommand(
  agentIdArg: string,
  options: CommandOptions,
  _command: Command,
): Promise<SingleResult<AgentRestartResult>> {
  const client = await connectToDaemon({ target: options.daemonTarget });
  try {
    // COMPAT(agentRestart): fork feature. Remove gate after 2027-05-01.
    if (client.getLastServerInfoMessage()?.features?.agentRestart !== true) {
      const error: CommandError = {
        code: "HOST_UPDATE_REQUIRED",
        message:
          'Update the host to use this. On older hosts, "paseo agent reload <id>" restarts the process but does not drain the queue.',
      };
      throw error;
    }
    const agentsPayload = await client.fetchAgents({ filter: { includeArchived: true } });
    const agentId = resolveAgentId(
      agentIdArg,
      agentsPayload.entries.map((entry) => entry.agent),
    );
    if (!agentId) {
      const error: CommandError = {
        code: "AGENT_NOT_FOUND",
        message: `Agent not found: ${agentIdArg}`,
        details: 'Use "paseo ls" to list available agents',
      };
      throw error;
    }
    const result = await client.restartAgent(agentId);
    const head = result.recoveredHead;
    return {
      type: "single",
      data: {
        agentId: result.agentId,
        mode: result.mode ?? "unknown",
        timelineSize: result.timelineSize ?? 0,
        queuedBefore: result.queuedBefore,
        queuedAfter: result.queuedAfter,
        recoveredHead: head
          ? `${head.itemId} ${head.outcome === "delivered" ? "(already delivered, dropped)" : "(resent)"}`
          : "none",
      },
      schema: restartSchema,
    };
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && "message" in err) throw err;
    const error: CommandError = {
      code: "RESTART_FAILED",
      message: `Failed to restart agent: ${err instanceof Error ? err.message : String(err)}`,
    };
    throw error;
  } finally {
    await client.close().catch(() => {});
  }
}
