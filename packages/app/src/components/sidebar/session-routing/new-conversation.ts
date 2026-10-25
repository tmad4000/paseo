import type { DefaultProjectPlacement } from "@/default-project/model";
import type { NewConversationWorkspace } from "./model";

export interface NewConversationCandidate extends NewConversationWorkspace {
  workspaceDirectory?: string;
  projectRootPath?: string;
}

export function defaultNewConversationWorkspace(input: {
  workspaces: readonly NewConversationCandidate[];
  serverIds: readonly string[];
  scope: string | null;
  active: { serverId: string; workspaceId: string } | null;
  /**
   * Each host's Default project in the sidebar projection (`useDefaultProjectPlacements`).
   * When the chosen host has one, it replaces the tmpworkspace basename heuristic below.
   */
  defaultProjects?: readonly DefaultProjectPlacement[];
}): NewConversationWorkspace | null {
  const eligible = input.workspaces.filter(
    (workspace) =>
      input.serverIds.includes(workspace.serverId) &&
      (input.scope === null || workspace.projectViewKey === input.scope),
  );
  if (input.scope !== null) {
    return (
      eligible.find(
        (workspace) =>
          workspace.serverId === input.active?.serverId &&
          workspace.workspaceId === input.active?.workspaceId,
      ) ?? (eligible.length === 1 ? eligible[0]! : null)
    );
  }
  let serverId = input.serverIds.length === 1 ? input.serverIds[0] : null;
  if (input.active && input.serverIds.includes(input.active.serverId))
    serverId = input.active.serverId;
  const defaultProject = input.defaultProjects?.find((project) => project.serverId === serverId);
  if (defaultProject) {
    return defaultProjectWorkspace(
      eligible.filter(
        (workspace) =>
          workspace.serverId === serverId &&
          workspace.projectViewKey === defaultProject.projectViewKey,
      ),
      input.active,
    );
  }
  const scratch = eligible.filter(
    (workspace) =>
      workspace.serverId === serverId &&
      [workspace.workspaceDirectory, workspace.projectRootPath].some(
        (path) =>
          path?.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop()?.toLowerCase() ===
          "tmpworkspace",
      ),
  );
  // Prefer the root workspace over one of its worktrees; ambiguity stays visible.
  const roots = scratch.filter(
    (workspace) => workspace.workspaceDirectory === workspace.projectRootPath,
  );
  if (roots.length === 1) return roots[0]!;
  return scratch.length === 1 ? scratch[0]! : null;
}

/**
 * The user named this project as the default, so a choice inside it is not a guess: the active
 * workspace when it is in the project, else the root checkout listed first in the sidebar, else
 * the first workspace listed. A Default project with no workspace yet requires a selection.
 */
function defaultProjectWorkspace(
  candidates: readonly NewConversationCandidate[],
  active: { serverId: string; workspaceId: string } | null,
): NewConversationWorkspace | null {
  const current = candidates.find(
    (workspace) =>
      workspace.serverId === active?.serverId && workspace.workspaceId === active?.workspaceId,
  );
  return (
    current ??
    candidates.find((workspace) => workspace.workspaceDirectory === workspace.projectRootPath) ??
    candidates[0] ??
    null
  );
}

export async function prepareNewConversationDraft(input: {
  workspace: NewConversationWorkspace;
  text: string;
  draftId: string;
  save: (draftId: string, text: string) => void;
  flush: () => Promise<void>;
  isEligible: () => boolean;
  navigate: (input: {
    serverId: string;
    workspaceId: string;
    target: { kind: "draft"; draftId: string };
  }) => void;
}): Promise<void> {
  if (!input.isEligible()) throw new Error("Choose an available workspace.");
  input.save(input.draftId, input.text);
  await input.flush();
  if (!input.isEligible()) throw new Error("Choose an available workspace.");
  input.navigate({
    serverId: input.workspace.serverId,
    workspaceId: input.workspace.workspaceId,
    target: { kind: "draft", draftId: input.draftId },
  });
}
