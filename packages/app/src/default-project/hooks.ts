import { useMemo, useRef } from "react";
import equal from "fast-deep-equal/es6";
import { useShallow } from "zustand/shallow";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { useSessionStore, type ProjectDescriptor } from "@/stores/session-store";
import {
  resolveDefaultProjectPlacements,
  resolveProjectPinState,
  selectHostDefaultProject,
  type DefaultProjectPlacement,
  type HostProjectRef,
  type ProjectPinState,
} from "./model";

/** The Default project of one host, as Quick launch and New conversation consume it. */
export interface DefaultProject {
  serverId: string;
  projectId: string;
  displayName: string;
  rootPath: string;
  projectKind: ProjectDescriptor["projectKind"];
  defaultAt: string;
}

interface ProjectsSessionState {
  sessions: Record<string, { projects: Map<string, ProjectDescriptor> } | undefined>;
}

/** Non-hook form of `useDefaultProjectForHost`, for imperative callers. */
export function selectDefaultProjectForHost(
  state: ProjectsSessionState,
  serverId: string | null | undefined,
): DefaultProject | null {
  if (!serverId) return null;
  const projects = state.sessions[serverId]?.projects;
  if (!projects) return null;
  const project = selectHostDefaultProject(projects.values());
  if (!project?.projectDefaultAt) return null;
  return {
    serverId,
    projectId: project.projectId,
    displayName: project.projectCustomName ?? project.projectDisplayName,
    rootPath: project.projectRootPath,
    projectKind: project.projectKind,
    defaultAt: project.projectDefaultAt,
  };
}

/**
 * The selected host's Default project: where new, unplaced work goes. Null when the host has
 * none (or predates project pinning). Quick launch and New conversation resolve their default
 * destination through this.
 */
export function useDefaultProjectForHost(serverId: string | null | undefined): DefaultProject | null {
  return useStoreWithEqualityFn(
    useSessionStore,
    (state) => selectDefaultProjectForHost(state, serverId),
    equal,
  );
}

function useProjectMaps(serverIds: readonly string[]) {
  return useSessionStore(
    useShallow((state) => serverIds.map((serverId) => state.sessions[serverId]?.projects ?? null)),
  );
}

function buildDefaultProjectIdByServerId(
  serverIds: readonly string[],
  projectMaps: ReadonlyArray<ReadonlyMap<string, ProjectDescriptor> | null>,
): Map<string, string> {
  const defaults = new Map<string, string>();
  serverIds.forEach((serverId, index) => {
    const projects = projectMaps[index];
    const project = projects ? selectHostDefaultProject(projects.values()) : null;
    if (project) defaults.set(serverId, project.projectId);
  });
  return defaults;
}

function collectServerIds(projects: readonly { hosts: readonly HostProjectRef[] }[]): string[] {
  return Array.from(new Set(projects.flatMap((project) => project.hosts.map((h) => h.serverId))));
}

/**
 * Pin state for each pinned or Default sidebar project, keyed by view key. Unpinned projects are
 * absent. The returned map keeps its identity while nothing pin-related changed, so it can feed
 * memoized ordering without re-sorting on unrelated project updates.
 */
export function useProjectPinStates(
  projects: readonly { viewKey: string; hosts: readonly HostProjectRef[] }[],
): ReadonlyMap<string, ProjectPinState> {
  const serverIds = useMemo(() => collectServerIds(projects), [projects]);
  const projectMaps = useProjectMaps(serverIds);
  const previous = useRef<ReadonlyMap<string, ProjectPinState>>(new Map());
  return useMemo(() => {
    const mapByServerId = new Map(serverIds.map((serverId, index) => [serverId, projectMaps[index]] as const));
    const defaultProjectIdByServerId = buildDefaultProjectIdByServerId(serverIds, projectMaps);
    const next = new Map<string, ProjectPinState>();
    for (const project of projects) {
      const state = resolveProjectPinState({
        hosts: project.hosts,
        getProject: (host) => mapByServerId.get(host.serverId)?.get(host.projectId),
        defaultProjectIdByServerId,
      });
      if (state) next.set(project.viewKey, state);
    }
    if (equal(next, previous.current)) return previous.current;
    previous.current = next;
    return next;
  }, [projectMaps, projects, serverIds]);
}

/** Pin state for one sidebar project, or null when it is neither pinned nor a Default project. */
export function useProjectPinState(hosts: readonly HostProjectRef[]): ProjectPinState | null {
  const serverIds = useMemo(() => Array.from(new Set(hosts.map((host) => host.serverId))), [hosts]);
  const projectMaps = useProjectMaps(serverIds);
  const previous = useRef<ProjectPinState | null>(null);
  return useMemo(() => {
    const mapByServerId = new Map(
      serverIds.map((serverId, index) => [serverId, projectMaps[index]] as const),
    );
    const next = resolveProjectPinState({
      hosts,
      getProject: (host) => mapByServerId.get(host.serverId)?.get(host.projectId),
      defaultProjectIdByServerId: buildDefaultProjectIdByServerId(serverIds, projectMaps),
    });
    if (equal(next, previous.current)) return previous.current;
    previous.current = next;
    return next;
  }, [hosts, projectMaps, serverIds]);
}

/** Each host's Default project located in the sidebar's grouped projection. */
export function useDefaultProjectPlacements(
  projects: readonly { viewKey: string; hosts: readonly HostProjectRef[] }[],
): DefaultProjectPlacement[] {
  const serverIds = useMemo(() => collectServerIds(projects), [projects]);
  const projectMaps = useProjectMaps(serverIds);
  const previous = useRef<DefaultProjectPlacement[]>([]);
  return useMemo(() => {
    const next = resolveDefaultProjectPlacements({
      projects,
      defaultProjectIdByServerId: buildDefaultProjectIdByServerId(serverIds, projectMaps),
    });
    if (equal(next, previous.current)) return previous.current;
    previous.current = next;
    return next;
  }, [projectMaps, projects, serverIds]);
}
