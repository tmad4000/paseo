import type { Command } from "commander";
import type {
  AgentPermissionRequest,
  AgentPermissionResponse,
} from "@getpaseo/protocol/agent-types";
import { connectToDaemon } from "../../utils/client.js";
import type { CommandOptions, ListResult, OutputSchema, CommandError } from "../../output/index.js";

/** Permission response item for display */
export interface PermissionResponseItem {
  requestId: string;
  agentId: string;
  agentShortId: string;
  name: string;
  result: string;
}

/** Schema for permit allow/deny output */
export const permitResponseSchema: OutputSchema<PermissionResponseItem> = {
  idField: "requestId",
  columns: [
    { header: "REQUEST ID", field: (item) => item.requestId.slice(0, 8), width: 12 },
    { header: "AGENT", field: "agentShortId", width: 10 },
    { header: "TOOL", field: "name", width: 20 },
    {
      header: "RESULT",
      field: "result",
      width: 10,
      color: (value) => {
        if (value === "allowed") return "green";
        if (value === "denied") return "red";
        return undefined;
      },
    },
  ],
};

/** Transform a permission the agent answered to a response item */
export function toPermissionResponseItem(
  agentId: string,
  permission: AgentPermissionRequest,
  result: "allowed" | "denied",
): PermissionResponseItem {
  return {
    requestId: permission.id,
    agentId,
    agentShortId: agentId.slice(0, 7),
    name: permission.name,
    result,
  };
}

/**
 * How long `permit allow` / `permit deny` wait for the daemon to confirm the response.
 * The daemon answers as soon as the provider has accepted it, so this only bounds a
 * lost or unreachable host.
 */
export const PERMIT_RESPONSE_TIMEOUT_MS = 15_000;

interface PermissionResponder {
  respondToPermissionAndWait(
    agentId: string,
    requestId: string,
    response: AgentPermissionResponse,
    timeout?: number,
  ): Promise<unknown>;
}

function isResponseTimeout(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if ((err as { code?: unknown }).code === "DAEMON_REQUEST_TIMEOUT") return true;
  return err.message.startsWith("Timeout waiting for message");
}

/**
 * Send a permission response and wait for the daemon's confirmation.
 *
 * A fire-and-forget send reported success even when the frame never reached the
 * daemon (for example when an `ssh://` tunnel was torn down right after the send),
 * leaving the request pending on the host. Waiting for `agent_permission_resolved`
 * makes a lost or rejected response a failed command instead of a false "allowed".
 */
export async function respondToPermissionConfirmed(
  client: PermissionResponder,
  agentId: string,
  permission: AgentPermissionRequest,
  response: AgentPermissionResponse,
  timeoutMs: number = PERMIT_RESPONSE_TIMEOUT_MS,
): Promise<void> {
  const verb = response.behavior === "allow" ? "allow" : "deny";
  try {
    await client.respondToPermissionAndWait(agentId, permission.id, response, timeoutMs);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isResponseTimeout(err)) {
      const error: CommandError = {
        code: "PERMISSION_RESPONSE_TIMEOUT",
        message: `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for the daemon to confirm ${verb} of ${permission.id}`,
        details: "The request may still be pending; check with `paseo permit ls`",
      };
      throw error;
    }
    const error: CommandError = {
      code: verb === "allow" ? "ALLOW_PERMISSION_FAILED" : "DENY_PERMISSION_FAILED",
      message: `Failed to ${verb} permission ${permission.id}: ${message}`,
    };
    throw error;
  }
}

export type PermitAllowResult = ListResult<PermissionResponseItem>;

export interface PermitAllowOptions extends CommandOptions {
  all?: boolean;
  input?: string;
  host?: string;
}

export async function runAllowCommand(
  agentIdOrPrefix: string,
  reqId: string | undefined,
  options: PermitAllowOptions,
  _command: Command,
): Promise<PermitAllowResult> {
  // No validation needed - if no reqId provided, allow all by default

  // Parse input JSON if provided
  let updatedInput: Record<string, unknown> | undefined;
  if (options.input) {
    try {
      updatedInput = JSON.parse(options.input);
    } catch (err) {
      const error: CommandError = {
        code: "INVALID_JSON",
        message: `Invalid JSON for --input: ${err instanceof Error ? err.message : String(err)}`,
        details: 'Provide valid JSON, e.g., --input \'{"key": "value"}\'',
      };
      throw error;
    }
  }

  const client = await connectToDaemon({ target: options.daemonTarget });

  try {
    const fetchResult = await client.fetchAgent({ agentId: agentIdOrPrefix });
    if (!fetchResult) {
      await client.close();
      const error: CommandError = {
        code: "AGENT_NOT_FOUND",
        message: `Agent not found: ${agentIdOrPrefix}`,
        details: 'Use "paseo ls" to list available agents',
      };
      throw error;
    }
    const agent = fetchResult.agent;
    const resolvedAgentId = agent.id;

    // Get pending permissions for this agent
    const pendingPermissions = agent.pendingPermissions || [];
    if (pendingPermissions.length === 0) {
      await client.close();
      const error: CommandError = {
        code: "NO_PENDING_PERMISSIONS",
        message: `No pending permissions for agent ${agent.id.slice(0, 7)}`,
      };
      throw error;
    }

    // Determine which permissions to allow
    let permissionsToAllow: AgentPermissionRequest[];
    if (!reqId || options.all) {
      // Default: allow all pending permissions if no req_id specified
      // --all flag is kept as an explicit alias for clarity
      permissionsToAllow = pendingPermissions;
    } else {
      // Find permission by ID prefix
      const permission = pendingPermissions.find((p) => p.id === reqId || p.id.startsWith(reqId));
      if (!permission) {
        await client.close();
        const error: CommandError = {
          code: "PERMISSION_NOT_FOUND",
          message: `Permission request not found: ${reqId}`,
          details: `Available requests: ${pendingPermissions.map((p) => p.id.slice(0, 8)).join(", ")}`,
        };
        throw error;
      }
      permissionsToAllow = [permission];
    }

    // Allow permissions
    const results: PermissionResponseItem[] = await Promise.all(
      permissionsToAllow.map(async (permission) => {
        await respondToPermissionConfirmed(client, resolvedAgentId, permission, {
          behavior: "allow",
          ...(updatedInput ? { updatedInput } : {}),
        });
        return toPermissionResponseItem(resolvedAgentId, permission, "allowed");
      }),
    );

    await client.close();

    return {
      type: "list",
      data: results,
      schema: permitResponseSchema,
    };
  } catch (err) {
    await client.close().catch(() => {});
    // Re-throw CommandErrors
    if (err && typeof err === "object" && "code" in err) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    const error: CommandError = {
      code: "ALLOW_PERMISSION_FAILED",
      message: `Failed to allow permission: ${message}`,
    };
    throw error;
  }
}
