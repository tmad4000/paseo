import type { Command } from "commander";
import type { UiWorkspaceTabTarget } from "@getpaseo/protocol/messages";
import { connectToDaemon, getDaemonHost } from "../../utils/client.js";
import { selectDaemonTarget } from "../../utils/daemon-target.js";
import type {
  CommandError,
  CommandOptions,
  OutputSchema,
  SingleResult,
} from "../../output/index.js";

export interface UiOpenTabOptions extends CommandOptions {
  host?: string;
  workspace?: string;
  agent?: string;
  subagentOf?: string;
  subagent?: string;
  terminal?: string;
  browser?: string;
  file?: string;
  line?: string;
  diff?: boolean;
  commit?: string;
  setup?: boolean;
  draft?: boolean;
  focus?: boolean;
}

export interface UiOpenTabRow {
  workspaceId: string;
  serverId: string;
  target: string;
  deliveredTo: number;
}

export const uiOpenTabSchema: OutputSchema<UiOpenTabRow> = {
  idField: "workspaceId",
  columns: [
    { header: "WORKSPACE ID", field: "workspaceId", width: 20 },
    { header: "SERVER ID", field: "serverId", width: 20 },
    { header: "TARGET", field: "target", width: 40 },
    { header: "DELIVERED TO", field: "deliveredTo", width: 12, align: "right" },
  ],
};

interface TargetChoice {
  flag: string;
  target: UiWorkspaceTabTarget;
}

function parsePositiveInt(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw {
      code: "INVALID_ARGUMENT",
      message: `${flag} must be a positive integer`,
    } satisfies CommandError;
  }
  return parsed;
}

/** Exactly one target flag has to win, so collect them all and count. */
function resolveTarget(options: UiOpenTabOptions): UiWorkspaceTabTarget {
  const choices: TargetChoice[] = [];

  if (options.agent) {
    choices.push({ flag: "--agent", target: { kind: "agent", agentId: options.agent } });
  }
  if (options.subagent) {
    if (!options.subagentOf) {
      throw {
        code: "INVALID_ARGUMENT",
        message: "--subagent requires --subagent-of <parent-agent-id>",
      } satisfies CommandError;
    }
    choices.push({
      flag: "--subagent",
      target: {
        kind: "provider_subagent",
        parentAgentId: options.subagentOf,
        subagentId: options.subagent,
      },
    });
  }
  if (options.terminal) {
    choices.push({
      flag: "--terminal",
      target: { kind: "terminal", terminalId: options.terminal },
    });
  }
  if (options.browser) {
    choices.push({ flag: "--browser", target: { kind: "browser", browserId: options.browser } });
  }
  if (options.file) {
    const lineStart = parsePositiveInt(options.line, "--line");
    choices.push({
      flag: "--file",
      target: {
        kind: "file",
        path: options.file,
        ...(lineStart === undefined ? {} : { lineStart }),
      },
    });
  }
  if (options.diff) {
    choices.push({ flag: "--diff", target: { kind: "working_diff" } });
  }
  if (options.commit) {
    choices.push({ flag: "--commit", target: { kind: "commit_diff", sha: options.commit } });
  }
  if (options.setup) {
    choices.push({
      flag: "--setup",
      target: { kind: "setup", workspaceId: options.workspace ?? "" },
    });
  }
  if (options.draft) {
    choices.push({ flag: "--draft", target: { kind: "draft" } });
  }

  const first = choices[0];
  if (!first) {
    throw {
      code: "INVALID_ARGUMENT",
      message:
        "Pick a tab to open: --agent, --terminal, --file, --draft, --browser, --diff, --commit, --setup, or --subagent",
    } satisfies CommandError;
  }
  if (choices.length > 1) {
    throw {
      code: "INVALID_ARGUMENT",
      message: `Pick one tab target, got ${choices.map((choice) => choice.flag).join(", ")}`,
    } satisfies CommandError;
  }
  return first.target;
}

function describeTarget(target: UiWorkspaceTabTarget): string {
  switch (target.kind) {
    case "draft":
      return target.draftId ? `draft:${target.draftId}` : "draft";
    case "agent":
      return `agent:${target.agentId}`;
    case "provider_subagent":
      return `subagent:${target.parentAgentId}/${target.subagentId}`;
    case "terminal":
      return `terminal:${target.terminalId}`;
    case "browser":
      return `browser:${target.browserId}`;
    case "file":
      return target.lineStart ? `file:${target.path}:${target.lineStart}` : `file:${target.path}`;
    case "working_diff":
      return "working_diff";
    case "setup":
      return `setup:${target.workspaceId}`;
    case "commit_diff":
      return `commit_diff:${target.sha}`;
    default:
      return "unknown";
  }
}

/**
 * Accept a workspace id, an unambiguous id prefix, or an exact workspace name.
 * The daemon only understands ids, so anything else is resolved here.
 */
async function resolveWorkspaceId(
  client: Awaited<ReturnType<typeof connectToDaemon>>,
  query: string,
): Promise<string> {
  const workspaces: { id: string; name: string }[] = [];
  let cursor: string | undefined;
  do {
    const payload = await client.fetchWorkspaces({
      page: { limit: 200, ...(cursor ? { cursor } : {}) },
    });
    workspaces.push(...payload.entries.map((entry) => ({ id: entry.id, name: entry.name })));
    cursor = payload.pageInfo.nextCursor ?? undefined;
  } while (cursor);

  const exact = workspaces.find((workspace) => workspace.id === query);
  if (exact) {
    return exact.id;
  }

  const lowered = query.toLowerCase();
  const prefixMatches = workspaces.filter((workspace) =>
    workspace.id.toLowerCase().startsWith(lowered),
  );
  if (prefixMatches.length === 1 && prefixMatches[0]) {
    return prefixMatches[0].id;
  }
  if (prefixMatches.length > 1) {
    throw {
      code: "WORKSPACE_AMBIGUOUS",
      message: `Workspace prefix "${query}" matches ${prefixMatches.length} workspaces`,
    } satisfies CommandError;
  }

  const nameMatches = workspaces.filter((workspace) => workspace.name.toLowerCase() === lowered);
  if (nameMatches.length === 1 && nameMatches[0]) {
    return nameMatches[0].id;
  }
  if (nameMatches.length > 1) {
    throw {
      code: "WORKSPACE_AMBIGUOUS",
      message: `Workspace name "${query}" matches ${nameMatches.length} workspaces`,
    } satisfies CommandError;
  }

  throw {
    code: "WORKSPACE_NOT_FOUND",
    message: `No workspace matches "${query}". List them with: paseo workspace ls`,
  } satisfies CommandError;
}

export async function runOpenTabCommand(
  options: UiOpenTabOptions,
  _command: Command,
): Promise<SingleResult<UiOpenTabRow>> {
  const workspaceQuery = options.workspace?.trim();
  if (!workspaceQuery) {
    throw {
      code: "INVALID_ARGUMENT",
      message: "--workspace <id> is required",
    } satisfies CommandError;
  }

  const target = resolveTarget(options);
  const daemonTarget = selectDaemonTarget(options);
  const host = getDaemonHost({ target: daemonTarget });
  const client = await connectToDaemon({ target: daemonTarget }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw {
      code: "DAEMON_NOT_RUNNING",
      message: `Cannot connect to daemon at ${host}: ${message}`,
      details: "Start the daemon with: paseo daemon start",
    } satisfies CommandError;
  });

  try {
    if (!client.supportsUiCommands()) {
      throw {
        code: "UNSUPPORTED_DAEMON",
        message: "This daemon does not support UI commands. Update the host to use this.",
      } satisfies CommandError;
    }

    const workspaceId = await resolveWorkspaceId(client, workspaceQuery);
    // --setup names the workspace being set up, which is the one we resolved.
    const resolvedTarget: UiWorkspaceTabTarget =
      target.kind === "setup" ? { kind: "setup", workspaceId } : target;

    const payload = await client.openWorkspaceTab({
      workspaceId,
      target: resolvedTarget,
      ...(options.focus === false ? { focus: false } : {}),
    });

    return {
      type: "single",
      data: {
        workspaceId: payload.workspaceId,
        serverId: payload.serverId,
        target: describeTarget(resolvedTarget),
        deliveredTo: payload.deliveredTo,
      },
      schema: uiOpenTabSchema,
    };
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && "message" in err) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    throw {
      code: "UI_TAB_OPEN_FAILED",
      message: `Failed to open tab: ${message}`,
    } satisfies CommandError;
  } finally {
    await client.close().catch(() => undefined);
  }
}
