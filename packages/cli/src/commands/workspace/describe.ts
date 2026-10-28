import type { Command } from "commander";
import type { WorkspaceDescription } from "@getpaseo/protocol/messages";
import { connectToDaemon, getDaemonHost } from "../../utils/client.js";
import type { CommandError, OutputSchema, SingleResult } from "../../output/index.js";

export interface WorkspaceDescribeOptions {
  host?: string;
  daemonTarget: import("../../utils/daemon-target.js").DaemonTarget;
  excludeSelf?: boolean;
}

function shortenPath(path: string): string {
  const home = process.env.HOME;
  return home && path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

/** Human output: one block per chat, focus summary first because that is what people ask for. */
export function renderWorkspaceDescription(description: WorkspaceDescription): string {
  const heading = [
    `${description.title ?? description.workspaceId} (${description.workspaceId})`,
    description.cwd ? shortenPath(description.cwd) : null,
  ]
    .filter(Boolean)
    .join("  ");
  if (description.agents.length === 0) return `${heading}\n\nNo other chats in this workspace.`;
  const blocks = description.agents.map((agent) => {
    const model = agent.model ? `${agent.provider}/${agent.model}` : agent.provider;
    const parent = agent.parentAgentId ? `  subagent of ${agent.parentAgentId.slice(0, 7)}` : "";
    const lines = [
      `${agent.id.slice(0, 7)}  ${agent.title ?? "(untitled)"}  [${agent.status}]  ${model}${parent}`,
      `  ${agent.focus.summary}`,
    ];
    return lines.join("\n");
  });
  return `${heading}\n\n${blocks.join("\n\n")}`;
}

const workspaceDescriptionSchema: OutputSchema<WorkspaceDescription> = {
  idField: "workspaceId",
  columns: [],
  renderHuman: (result) =>
    result.type === "single" ? renderWorkspaceDescription(result.data) : "",
};

/**
 * Resolve which workspace to describe. Inside a Paseo agent shell PASEO_AGENT_ID names the caller,
 * so `paseo workspace describe` with no argument means "my workspace".
 */
export async function resolveDescribeTarget(
  explicitWorkspaceId: string | undefined,
  lookupAgentWorkspace: (agentId: string) => Promise<string | null>,
  env: { PASEO_AGENT_ID?: string } = process.env,
): Promise<{ workspaceId: string; callerAgentId: string | null }> {
  const callerAgentId = env.PASEO_AGENT_ID?.trim() || null;
  const workspaceId = explicitWorkspaceId?.trim();
  if (workspaceId) return { workspaceId, callerAgentId };
  if (!callerAgentId) {
    throw {
      code: "MISSING_WORKSPACE",
      message: "Pass a workspace id, or run this inside a Paseo agent shell",
      details: "Usage: paseo workspace describe <workspace-id>  (see: paseo workspace ls)",
    } satisfies CommandError;
  }
  const callerWorkspaceId = await lookupAgentWorkspace(callerAgentId);
  if (!callerWorkspaceId) {
    throw {
      code: "MISSING_WORKSPACE",
      message: `Agent ${callerAgentId} has no workspace on this daemon`,
      details: "Pass a workspace id explicitly",
    } satisfies CommandError;
  }
  return { workspaceId: callerWorkspaceId, callerAgentId };
}

export async function runDescribeCommand(
  workspaceIdArg: string | undefined,
  options: WorkspaceDescribeOptions,
  _command: Command,
): Promise<SingleResult<WorkspaceDescription>> {
  const host = getDaemonHost({ target: options.daemonTarget });
  const client = await connectToDaemon({ target: options.daemonTarget }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw {
      code: "DAEMON_NOT_RUNNING",
      message: `Cannot connect to daemon at ${host}: ${message}`,
      details: "Start the daemon with: paseo daemon start",
    } satisfies CommandError;
  });
  try {
    if (client.getLastServerInfoMessage()?.features?.workspaceDescribe !== true) {
      throw {
        code: "DAEMON_UPDATE_REQUIRED",
        message: `The daemon at ${host} does not support workspace describe`,
        details: "Update the Paseo daemon, then retry",
      } satisfies CommandError;
    }
    const { workspaceId, callerAgentId } = await resolveDescribeTarget(
      workspaceIdArg,
      async (agentId) => (await client.fetchAgent(agentId))?.agent.workspaceId ?? null,
    );
    const description = await client.describeWorkspace(
      workspaceId,
      options.excludeSelf && callerAgentId ? { excludeAgentId: callerAgentId } : {},
    );
    return { type: "single", data: description, schema: workspaceDescriptionSchema };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw { code: "WORKSPACE_DESCRIBE_FAILED", message } satisfies CommandError;
  } finally {
    await client.close().catch(() => undefined);
  }
}
