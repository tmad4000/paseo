import type { UiCommandMessage, UiWorkspaceTabTarget } from "@getpaseo/protocol/messages";
import { normalizeWorkspaceTabTarget } from "@/workspace-tabs/identity";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

/**
 * A `ui.command` push carries the daemon's view of a tab target. This turns it
 * into the app's own `WorkspaceTabTarget`, dropping anything the app cannot
 * open. The daemon never sees tab state, so this is the only place the two
 * shapes meet.
 */

export interface ResolvedUiTabOpenCommand {
  serverId: string;
  workspaceId: string;
  target: WorkspaceTabTarget;
  focus: boolean;
}

/** `prepareWorkspaceTab` swaps this sentinel for a freshly generated draft id. */
const NEW_DRAFT_ID = "new";

export function toWorkspaceTabTarget(target: UiWorkspaceTabTarget): WorkspaceTabTarget | null {
  switch (target.kind) {
    case "draft":
      return normalizeWorkspaceTabTarget({
        kind: "draft",
        draftId: target.draftId?.trim() || NEW_DRAFT_ID,
      });
    case "agent":
      return normalizeWorkspaceTabTarget({ kind: "agent", agentId: target.agentId });
    case "provider_subagent":
      return normalizeWorkspaceTabTarget({
        kind: "provider_subagent",
        parentAgentId: target.parentAgentId,
        subagentId: target.subagentId,
      });
    case "terminal":
      return normalizeWorkspaceTabTarget({ kind: "terminal", terminalId: target.terminalId });
    case "browser":
      return normalizeWorkspaceTabTarget({ kind: "browser", browserId: target.browserId });
    case "file":
      return normalizeWorkspaceTabTarget({
        kind: "file",
        path: target.path,
        ...(typeof target.lineStart === "number" ? { lineStart: target.lineStart } : {}),
        ...(typeof target.lineEnd === "number" ? { lineEnd: target.lineEnd } : {}),
      });
    case "working_diff":
      return normalizeWorkspaceTabTarget({
        kind: "working_diff",
        ...(target.focusPath ? { focusPath: target.focusPath } : {}),
      });
    case "setup":
      return normalizeWorkspaceTabTarget({ kind: "setup", workspaceId: target.workspaceId });
    case "commit_diff":
      return normalizeWorkspaceTabTarget({ kind: "commit_diff", sha: target.sha });
    default:
      return null;
  }
}

export function resolveUiCommand(input: {
  /** The server the push arrived on, used when the daemon did not name itself. */
  connectionServerId: string;
  payload: UiCommandMessage["payload"];
}): ResolvedUiTabOpenCommand | null {
  const { payload } = input;
  if (payload.command !== "tab.open") {
    return null;
  }

  const serverId = payload.serverId?.trim() || input.connectionServerId.trim();
  const workspaceId = payload.workspaceId.trim();
  if (!serverId || !workspaceId) {
    return null;
  }

  const target = toWorkspaceTabTarget(payload.target);
  if (!target) {
    return null;
  }

  return { serverId, workspaceId, target, focus: payload.focus !== false };
}
