import { applyStoredOrdering } from "@/hooks/sidebar-workspaces-view-model";

/** One project on one host. A sidebar project groups one of these per host. */
export interface HostProjectRef {
  serverId: string;
  projectId: string;
}

/** The project descriptor fields this module reads. */
export interface ProjectPinFields {
  projectId: string;
  projectPinnedAt?: string | null;
  projectDefaultAt?: string | null;
}

/**
 * Pin state of one sidebar project, which may group the same logical project across hosts.
 *
 * Pinned means pinned on any host. The Default project is per host; a grouped project is the
 * default when it is the default on any host in the group, and a default is always treated as
 * pinned. `sortAt` is the newest pin or default timestamp, used for most-recently-pinned order.
 */
export interface ProjectPinState {
  pinned: boolean;
  isDefault: boolean;
  sortAt: string;
  pinnedHosts: HostProjectRef[];
  defaultHosts: HostProjectRef[];
}

/**
 * The host's Default project. Exactly one is expected; if a race on the host ever leaves two,
 * the newest `projectDefaultAt` wins, so every reader agrees without a repair pass.
 */
export function selectHostDefaultProject<T extends ProjectPinFields>(
  projects: Iterable<T>,
): T | null {
  let current: T | null = null;
  for (const project of projects) {
    if (!project.projectDefaultAt) continue;
    if (!current || project.projectDefaultAt > (current.projectDefaultAt ?? "")) current = project;
  }
  return current;
}

export function resolveProjectPinState(input: {
  hosts: readonly HostProjectRef[];
  getProject: (host: HostProjectRef) => ProjectPinFields | undefined;
  defaultProjectIdByServerId: ReadonlyMap<string, string>;
}): ProjectPinState | null {
  const pinnedHosts: HostProjectRef[] = [];
  const defaultHosts: HostProjectRef[] = [];
  let sortAt = "";
  for (const host of input.hosts) {
    const project = input.getProject(host);
    if (!project) continue;
    if (project.projectPinnedAt) {
      pinnedHosts.push(host);
      if (project.projectPinnedAt > sortAt) sortAt = project.projectPinnedAt;
    }
    if (input.defaultProjectIdByServerId.get(host.serverId) === host.projectId) {
      defaultHosts.push(host);
      if (project.projectDefaultAt && project.projectDefaultAt > sortAt) {
        sortAt = project.projectDefaultAt;
      }
    }
  }
  if (pinnedHosts.length === 0 && defaultHosts.length === 0) return null;
  return {
    pinned: true,
    isDefault: defaultHosts.length > 0,
    sortAt,
    pinnedHosts,
    defaultHosts,
  };
}

/**
 * Hoists pinned projects above the rest, regardless of the sidebar sort mode, the way pinned
 * chats are stable. Among pinned projects: Default first, then the user's drag order, and
 * most-recently-pinned first for projects the user has not dragged. Unpinned projects keep the
 * order they arrived in.
 */
export function orderProjectsWithPins<T extends { viewKey: string }>(input: {
  projects: readonly T[];
  pinStates: ReadonlyMap<string, ProjectPinState>;
  pinnedProjectOrder: readonly string[];
}): { projects: T[]; pinnedViewKeys: ReadonlySet<string> } {
  const pinned: T[] = [];
  const unpinned: T[] = [];
  for (const project of input.projects) {
    (input.pinStates.has(project.viewKey) ? pinned : unpinned).push(project);
  }
  if (pinned.length === 0) {
    return { projects: [...input.projects], pinnedViewKeys: new Set() };
  }
  const sortAt = (project: T) => input.pinStates.get(project.viewKey)?.sortAt ?? "";
  pinned.sort((left, right) => sortAt(right).localeCompare(sortAt(left)));
  const dragged = applyStoredOrdering({
    items: pinned,
    storedOrder: [...input.pinnedProjectOrder],
    getKey: (project) => project.viewKey,
  });
  const isDefault = (project: T) => input.pinStates.get(project.viewKey)?.isDefault === true;
  const ordered = [...dragged.filter(isDefault), ...dragged.filter((item) => !isDefault(item))];
  return {
    projects: [...ordered, ...unpinned],
    pinnedViewKeys: new Set(ordered.map((project) => project.viewKey)),
  };
}

/** Splits an ordered project list into its pinned head and the rest, preserving order. */
export function splitPinnedProjects<T extends { viewKey: string }>(
  projects: readonly T[],
  pinnedViewKeys: ReadonlySet<string>,
): { pinned: T[]; rest: T[] } {
  if (pinnedViewKeys.size === 0) return { pinned: [], rest: [...projects] };
  const pinned: T[] = [];
  const rest: T[] = [];
  for (const project of projects) {
    (pinnedViewKeys.has(project.viewKey) ? pinned : rest).push(project);
  }
  return { pinned, rest };
}

/** Where a Default project sits in the sidebar's grouped projection, per host. */
export interface DefaultProjectPlacement {
  serverId: string;
  projectViewKey: string;
}

export function resolveDefaultProjectPlacements(input: {
  projects: readonly { viewKey: string; hosts: readonly HostProjectRef[] }[];
  defaultProjectIdByServerId: ReadonlyMap<string, string>;
}): DefaultProjectPlacement[] {
  const placements: DefaultProjectPlacement[] = [];
  for (const project of input.projects) {
    for (const host of project.hosts) {
      if (input.defaultProjectIdByServerId.get(host.serverId) === host.projectId) {
        placements.push({ serverId: host.serverId, projectViewKey: project.viewKey });
      }
    }
  }
  return placements;
}

export interface DefaultProjectWorkspaceCandidate {
  id: string;
  projectId: string;
  workspaceDirectory: string;
  projectRootPath: string;
  statusEnteredAt: Date | null;
  archivingAt: string | null;
}

/**
 * The workspace "Go to default project" opens: the one with the most recent agent activity,
 * then the most recent status change, then the project's root checkout. Null means the project
 * has no workspace yet, and the caller opens its New workspace screen instead.
 */
export function resolveDefaultProjectWorkspaceId(input: {
  projectId: string;
  workspaces: Iterable<DefaultProjectWorkspaceCandidate>;
  lastActivityAtByWorkspaceId: ReadonlyMap<string, Date>;
}): string | null {
  let best: { id: string; activity: number; status: number; root: number } | null = null;
  for (const workspace of input.workspaces) {
    if (workspace.projectId !== input.projectId || workspace.archivingAt) continue;
    const candidate = {
      id: workspace.id,
      activity: input.lastActivityAtByWorkspaceId.get(workspace.id)?.getTime() ?? 0,
      status: workspace.statusEnteredAt?.getTime() ?? 0,
      root: workspace.workspaceDirectory === workspace.projectRootPath ? 1 : 0,
    };
    if (
      !best ||
      candidate.activity > best.activity ||
      (candidate.activity === best.activity && candidate.status > best.status) ||
      (candidate.activity === best.activity &&
        candidate.status === best.status &&
        candidate.root > best.root)
    ) {
      best = candidate;
    }
  }
  return best?.id ?? null;
}
