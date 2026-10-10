import type {
  SessionOutboundMessage,
  UiTabPlacement,
  UiWorkspaceTabTarget,
} from "@getpaseo/protocol/messages";
import { browserIdForUrl, normalizeUiBrowserUrl } from "@getpaseo/protocol/ui-browser-target";

/**
 * UI commands are pass-through. The daemon owns no tab state — the app does —
 * so all the daemon can usefully do is check that the thing being pointed at
 * exists and then fan the command out to every attached client. Keeping the
 * decision in a pure function makes it testable without booting a daemon.
 */

export type UiCommandMessage = Extract<SessionOutboundMessage, { type: "ui.command" }>;

export interface UiTabOpenCommandInput {
  serverId?: string | undefined;
  workspaceId: string;
  target: UiWorkspaceTabTarget;
  focus?: boolean | undefined;
  placement?: UiTabPlacement | undefined;
}

export interface UiTabOpenCommandDeps {
  /** The daemon's own server id, used when the caller does not supply one. */
  serverId: string;
  workspaceExists: (workspaceId: string) => Promise<boolean>;
}

export type UiTabOpenCommandResult =
  | { ok: true; serverId: string; workspaceId: string; command: UiCommandMessage }
  | { ok: false; serverId: string; workspaceId: string; error: string };

function trimNonEmpty(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeFileTarget(
  target: Extract<UiWorkspaceTabTarget, { kind: "file" }>,
): UiWorkspaceTabTarget | null {
  const path = trimNonEmpty(target.path);
  if (!path) {
    return null;
  }
  const { lineStart, lineEnd } = target;
  if (typeof lineStart !== "number") {
    return { kind: "file", path };
  }
  if (typeof lineEnd !== "number" || lineEnd < lineStart) {
    return { kind: "file", path, lineStart };
  }
  return { kind: "file", path, lineStart, lineEnd };
}

/**
 * A browser target names an existing browser, a page, or both. A page without an id gets the
 * id derived from its URL, so every client (and a later close) agrees on which tab it is. A
 * URL that is not absolute http(s) is rejected rather than silently dropped.
 */
function normalizeBrowserTarget(
  target: Extract<UiWorkspaceTabTarget, { kind: "browser" }>,
): UiWorkspaceTabTarget | null {
  const rawUrl = trimNonEmpty(target.url);
  const url = rawUrl ? normalizeUiBrowserUrl(rawUrl) : null;
  if (rawUrl && !url) {
    return null;
  }
  const browserId = trimNonEmpty(target.browserId) ?? (url ? browserIdForUrl(url) : null);
  if (!browserId) {
    return null;
  }
  return url ? { kind: "browser", browserId, url } : { kind: "browser", browserId };
}

function normalizeEntityTarget(target: UiWorkspaceTabTarget): UiWorkspaceTabTarget | null {
  switch (target.kind) {
    case "agent": {
      const agentId = trimNonEmpty(target.agentId);
      return agentId ? { kind: "agent", agentId } : null;
    }
    case "provider_subagent": {
      const parentAgentId = trimNonEmpty(target.parentAgentId);
      const subagentId = trimNonEmpty(target.subagentId);
      return parentAgentId && subagentId
        ? { kind: "provider_subagent", parentAgentId, subagentId }
        : null;
    }
    case "terminal": {
      const terminalId = trimNonEmpty(target.terminalId);
      return terminalId ? { kind: "terminal", terminalId } : null;
    }
    case "browser":
      return normalizeBrowserTarget(target);
    case "setup": {
      const workspaceId = trimNonEmpty(target.workspaceId);
      return workspaceId ? { kind: "setup", workspaceId } : null;
    }
    case "commit_diff": {
      const sha = trimNonEmpty(target.sha);
      return sha ? { kind: "commit_diff", sha } : null;
    }
    default:
      return null;
  }
}

/**
 * Trim identifiers and reject targets whose required identifier is blank.
 * The wire schema only guarantees the fields are strings.
 */
export function normalizeUiWorkspaceTabTarget(
  target: UiWorkspaceTabTarget,
): UiWorkspaceTabTarget | null {
  switch (target.kind) {
    case "draft": {
      const draftId = trimNonEmpty(target.draftId);
      return draftId ? { kind: "draft", draftId } : { kind: "draft" };
    }
    case "file":
      return normalizeFileTarget(target);
    case "working_diff": {
      const focusPath = trimNonEmpty(target.focusPath);
      return focusPath ? { kind: "working_diff", focusPath } : { kind: "working_diff" };
    }
    default:
      return normalizeEntityTarget(target);
  }
}

export async function resolveUiTabOpenCommand(
  input: UiTabOpenCommandInput,
  deps: UiTabOpenCommandDeps,
): Promise<UiTabOpenCommandResult> {
  return resolveUiTabCommand(input, deps, (context) => ({
    command: "tab.open",
    ...context,
    ...(input.focus === false ? { focus: false } : {}),
    ...(input.placement === "side" ? { placement: "side" as const } : {}),
  }));
}

export async function resolveUiTabCloseCommand(
  input: Omit<UiTabOpenCommandInput, "focus" | "placement">,
  deps: UiTabOpenCommandDeps,
): Promise<UiTabOpenCommandResult> {
  return resolveUiTabCommand(input, deps, (context) => ({
    command: "tab.close",
    ...context,
  }));
}

async function resolveUiTabCommand(
  input: Omit<UiTabOpenCommandInput, "focus" | "placement">,
  deps: UiTabOpenCommandDeps,
  buildPayload: (context: {
    serverId: string;
    workspaceId: string;
    target: UiWorkspaceTabTarget;
  }) => UiCommandMessage["payload"],
): Promise<UiTabOpenCommandResult> {
  const serverId = trimNonEmpty(input.serverId) ?? deps.serverId;
  const workspaceId = trimNonEmpty(input.workspaceId) ?? "";

  if (!workspaceId) {
    return { ok: false, serverId, workspaceId, error: "workspaceId is required" };
  }

  const target = normalizeUiWorkspaceTabTarget(input.target);
  if (!target) {
    return {
      ok: false,
      serverId,
      workspaceId,
      error: `Invalid tab target for kind "${input.target.kind}"`,
    };
  }

  if (!(await deps.workspaceExists(workspaceId))) {
    return { ok: false, serverId, workspaceId, error: `Workspace not found: ${workspaceId}` };
  }

  return {
    ok: true,
    serverId,
    workspaceId,
    command: {
      type: "ui.command",
      payload: buildPayload({ serverId, workspaceId, target }),
    },
  };
}
