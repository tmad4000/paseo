import {
  defaultNewConversationWorkspace,
  type NewConversationCandidate,
} from "@/components/sidebar/session-routing/new-conversation";
import {
  getHostProjectSourceDirectory,
  type HostProjectListItem,
} from "@/projects/host-projects";
import type { QuickLaunchTarget } from "./launch";

export interface QuickLaunchWorkspaceRef {
  serverId: string;
  workspaceId: string;
}

/** A project on one host; `projectViewKey` is null when a host was chosen without a project. */
export interface QuickLaunchProjectChoice {
  serverId: string;
  projectViewKey: string | null;
}

/** Where the agent opens: a new workspace in the chosen project, or a new tab in a workspace. */
export type QuickLaunchWhere = "new-workspace" | "existing-workspace";

export function findProjectForWorkspace(
  projects: readonly HostProjectListItem[],
  workspace: QuickLaunchWorkspaceRef,
): HostProjectListItem | null {
  const workspaceKey = `${workspace.serverId}:${workspace.workspaceId}`;
  return projects.find((project) => project.workspaceKeys.includes(workspaceKey)) ?? null;
}

export function findProjectChoice(
  projects: readonly HostProjectListItem[],
  choice: QuickLaunchProjectChoice | null,
): HostProjectListItem | null {
  if (!choice?.projectViewKey) return null;
  const project = projects.find((candidate) => candidate.viewKey === choice.projectViewKey);
  if (!project?.hosts.some((host) => host.serverId === choice.serverId)) return null;
  return project;
}

/**
 * The project Quick launch starts in unless the user picks another one for this launch.
 *
 * This is the single place that decides the default. It reuses New conversation's scratch
 * destination (`defaultNewConversationWorkspace`, All projects scope) at project granularity:
 * one root candidate per project placement, so a scratch project with many workspaces still
 * resolves. When no scratch project exists on the preferred host, the active workspace's project
 * is used. The Default project setting replaces the scratch lookup here once it lands.
 * Nothing remembers the last destination: the default wins on every open.
 */
export function resolveQuickLaunchDefaultDestination(input: {
  projects: readonly HostProjectListItem[];
  serverIds: readonly string[];
  active: QuickLaunchWorkspaceRef | null;
}): QuickLaunchProjectChoice | null {
  const projectRoots: NewConversationCandidate[] = input.projects.flatMap((project) =>
    project.hosts.map((host) => ({
      serverId: host.serverId,
      // Only read for scoped lookups; with All projects scope the heuristic keys on directories.
      workspaceId: host.projectId,
      projectViewKey: project.viewKey,
      projectName: project.projectName,
      name: project.projectName,
      workspaceDirectory: host.iconWorkingDir,
      projectRootPath: host.iconWorkingDir,
    })),
  );
  const scratch = defaultNewConversationWorkspace({
    workspaces: projectRoots,
    serverIds: input.serverIds,
    scope: null,
    active: input.active,
  });
  if (scratch) {
    return { serverId: scratch.serverId, projectViewKey: scratch.projectViewKey };
  }
  if (!input.active || !input.serverIds.includes(input.active.serverId)) return null;
  const activeProject = findProjectForWorkspace(input.projects, input.active);
  if (!activeProject) return null;
  return { serverId: input.active.serverId, projectViewKey: activeProject.viewKey };
}

/**
 * Whether a new workspace gets its own Paseo worktree. Mirrors the New workspace screen: hosts
 * without workspace multiplicity only create worktrees; otherwise the remembered Isolation choice
 * applies wherever the project supports worktrees.
 */
export function resolveCreatesWorktree(input: {
  supportsMultiplicity: boolean;
  isolation: "local" | "worktree";
  worktreeSupport: "supported" | "unsupported" | "unknown";
}): boolean {
  // COMPAT(workspaceMultiplicity): added in v0.1.97, drop the gate when floor >= v0.1.97
  if (!input.supportsMultiplicity) return true;
  return input.isolation === "worktree" && input.worktreeSupport !== "unsupported";
}

/** What Start would create from the dialog's current choices, or null when it cannot start. */
export function resolveQuickLaunchTarget(input: {
  where: QuickLaunchWhere;
  workspace: (QuickLaunchWorkspaceRef & { workspaceDirectory: string }) | null;
  project: HostProjectListItem | null;
  serverId: string;
  supportsMultiplicity: boolean;
  isolation: "local" | "worktree";
  worktreeSupport: "supported" | "unsupported" | "unknown";
}): QuickLaunchTarget | null {
  if (input.where === "existing-workspace") {
    if (!input.workspace) return null;
    return {
      kind: "existing-workspace",
      serverId: input.workspace.serverId,
      workspaceId: input.workspace.workspaceId,
      workspaceDirectory: input.workspace.workspaceDirectory,
    };
  }
  if (!input.project) return null;
  const sourceDirectory = getHostProjectSourceDirectory(input.project, input.serverId);
  if (!sourceDirectory) return null;
  return {
    kind: "new-workspace",
    serverId: input.serverId,
    project: input.project,
    sourceDirectory,
    createsWorktree: resolveCreatesWorktree(input),
  };
}
