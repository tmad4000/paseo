import type { Command } from "commander";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { connectToDaemon, getDaemonHost, resolveAgentId } from "../../utils/client.js";
import type {
  CommandError,
  CommandOptions,
  OutputSchema,
  SingleResult,
} from "../../output/index.js";

interface AgentArtifactsScanResult {
  agentId: string;
  addedOrUpdated: number;
  total: number;
}

const artifactsScanSchema: OutputSchema<AgentArtifactsScanResult> = {
  idField: "agentId",
  columns: [
    { header: "AGENT ID", field: "agentId" },
    { header: "ADDED/UPDATED", field: "addedOrUpdated" },
    { header: "TOTAL", field: "total" },
  ],
};

export interface ArtifactsScanOptions extends CommandOptions {
  limit?: string;
}

export function addArtifactsScanOptions(command: Command): Command {
  return command.option(
    "--limit <count>",
    "Maximum artifacts to retain, newest first (default: daemon default)",
  );
}

/**
 * Backfills an agent's artifact feed from files already on disk.
 *
 * Artifacts are normally collected per turn, so an agent that did its work
 * before the feature existed shows an empty feed no matter how much it
 * produced. This scans its working directory once and records what it finds.
 */
export async function runArtifactsScanCommand(
  agentIdArg: string,
  options: ArtifactsScanOptions,
  _command: Command,
): Promise<SingleResult<AgentArtifactsScanResult>> {
  let limit: number | undefined;
  if (options.limit !== undefined) {
    const parsed = Number.parseInt(options.limit, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw {
        code: "INVALID_ARGUMENT",
        message: `--limit must be a positive integer, got: ${options.limit}`,
      } satisfies CommandError;
    }
    limit = parsed;
  }

  const host = getDaemonHost({ host: options.host });
  let client: DaemonClient;
  try {
    client = await connectToDaemon({ host: options.host });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw {
      code: "DAEMON_NOT_RUNNING",
      message: `Cannot connect to daemon at ${host}: ${message}`,
    } satisfies CommandError;
  }

  try {
    const payload = await client.fetchAgents({ filter: { includeArchived: true } });
    const agentId = resolveAgentId(
      agentIdArg,
      payload.entries.map((entry) => entry.agent),
    );
    if (!agentId) {
      throw {
        code: "AGENT_NOT_FOUND",
        message: `Agent not found: ${agentIdArg}`,
      } satisfies CommandError;
    }
    const result = await client.scanAgentArtifacts(agentId, limit !== undefined ? { limit } : {});
    return {
      type: "single",
      data: { agentId, addedOrUpdated: result.addedOrUpdated, total: result.total },
      schema: artifactsScanSchema,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}
