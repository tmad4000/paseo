import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";

export type SidebarSortMode = "manual" | "recent" | "title";

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

export function sortSidebarWorkspaces<T extends SidebarWorkspacePlacement>(
  workspaces: readonly T[],
  entries: ReadonlyMap<string, SidebarWorkspaceEntry>,
  mode: SidebarSortMode,
): T[] {
  if (mode === "manual") return [...workspaces];
  return [...workspaces].sort((left, right) => {
    const leftEntry = entries.get(left.workspaceKey);
    const rightEntry = entries.get(right.workspaceKey);
    if (mode === "recent") {
      const timeDifference =
        (rightEntry?.lastActivityAt?.getTime() ?? 0) - (leftEntry?.lastActivityAt?.getTime() ?? 0);
      if (timeDifference !== 0) return timeDifference;
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
}): SidebarProjectEntry[] {
  const { projects, entries, query, mode } = input;
  if (!query && mode === "manual") return [...projects];
  return projects.flatMap((project) => {
    const projectMatches = project.projectName
      .normalize("NFKC")
      .toLocaleLowerCase()
      .includes(query);
    const workspaces = project.workspaces.filter((workspace) => {
      if (!query || projectMatches) return true;
      const entry = entries.get(workspace.workspaceKey);
      return entry ? workspaceMatchesSidebarQuery(entry, query) : false;
    });
    if (query && !projectMatches && workspaces.length === 0) return [];
    return [{ ...project, workspaces: sortSidebarWorkspaces(workspaces, entries, mode) }];
  });
}
