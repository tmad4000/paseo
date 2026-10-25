import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";

export type SidebarSortMode = "manual" | "recent" | "user" | "assistant" | "title";

export function normalizeSidebarQuery(query: string): string {
  return query.trim().normalize("NFKC").toLocaleLowerCase();
}

export function workspaceMatchesSidebarQuery(
  workspace: SidebarWorkspaceEntry,
  query: string,
): boolean {
  if (!query) return true;
  return [workspace.title, workspace.name, workspace.projectName].some((value) =>
    value?.normalize("NFKC").toLocaleLowerCase().includes(query),
  );
}

/**
 * The live filter's workspace test: the workspace's own names, or any of its tab titles. Tab
 * matches are computed once per keystroke for every host (`matchSidebarTabTitles`), so this only
 * asks whether the workspace is among them.
 */
export function workspaceMatchesSidebarFilter(
  workspace: SidebarWorkspaceEntry,
  query: string,
  tabMatchedWorkspaceKeys?: ReadonlySet<string>,
): boolean {
  return (
    workspaceMatchesSidebarQuery(workspace, query) ||
    tabMatchedWorkspaceKeys?.has(workspace.workspaceKey) === true
  );
}

export function sortSidebarWorkspaces<T extends SidebarWorkspacePlacement>(
  workspaces: readonly T[],
  entries: ReadonlyMap<string, SidebarWorkspaceEntry>,
  mode: SidebarSortMode,
): T[] {
  if (mode === "manual") return [...workspaces];
  return [...workspaces].sort((left, right) => {
    const leftEntry = entries.get(left.workspaceKey);
    const rightEntry = entries.get(right.workspaceKey);
    if (mode === "recent" || mode === "user" || mode === "assistant") {
      // Equal or unknown clocks preserve stored order; title edits must not reshuffle ties.
      return sidebarMessageTimestamp(rightEntry, mode) - sidebarMessageTimestamp(leftEntry, mode);
    }
    const titleDifference = (leftEntry?.title || leftEntry?.name || left.name).localeCompare(
      rightEntry?.title || rightEntry?.name || right.name,
      undefined,
      { sensitivity: "base" },
    );
    return titleDifference || left.workspaceKey.localeCompare(right.workspaceKey);
  });
}

export function filterAndSortSidebarProjects(input: {
  projects: readonly SidebarProjectEntry[];
  entries: ReadonlyMap<string, SidebarWorkspaceEntry>;
  query: string;
  mode: SidebarSortMode;
  /** Workspaces kept because one of their tab titles matches `query`. */
  tabMatchedWorkspaceKeys?: ReadonlySet<string>;
}): SidebarProjectEntry[] {
  const { projects, entries, query, mode, tabMatchedWorkspaceKeys } = input;
  if (!query && mode === "manual") return [...projects];
  const visibleProjects = projects.flatMap((project) => {
    const projectMatches = project.projectName
      .normalize("NFKC")
      .toLocaleLowerCase()
      .includes(query);
    const workspaces = project.workspaces.filter((workspace) => {
      if (!query || projectMatches) return true;
      const entry = entries.get(workspace.workspaceKey);
      return entry ? workspaceMatchesSidebarFilter(entry, query, tabMatchedWorkspaceKeys) : false;
    });
    if (query && !projectMatches && workspaces.length === 0) return [];
    return [{ ...project, workspaces: sortSidebarWorkspaces(workspaces, entries, mode) }];
  });
  if (mode === "manual") return visibleProjects;
  if (mode === "title") {
    return visibleProjects.sort(
      (left, right) =>
        left.projectName.localeCompare(right.projectName, undefined, { sensitivity: "base" }) ||
        left.viewKey.localeCompare(right.viewKey),
    );
  }
  const latestActivity = (project: SidebarProjectEntry) =>
    project.workspaces.reduce(
      (latest, workspace) =>
        Math.max(latest, sidebarMessageTimestamp(entries.get(workspace.workspaceKey), mode)),
      0,
    );
  // Stable sorting keeps the stored project order for empty projects and equal timestamps.
  return visibleProjects.sort((left, right) => latestActivity(right) - latestActivity(left));
}

function sidebarMessageTimestamp(
  entry: SidebarWorkspaceEntry | undefined,
  mode: SidebarSortMode,
): number {
  let at = entry?.lastMessageAt;
  if (mode === "user") at = entry?.lastUserMessageAt;
  if (mode === "assistant") at = entry?.lastAssistantMessageAt;
  const time = at?.getTime();
  return time !== undefined && Number.isFinite(time) ? time : 0;
}
