import { describe, expect, it } from "vitest";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";
import type { SidebarGroupMode } from "@/stores/sidebar-view-store";
import type { SidebarSortMode } from "./sidebar-filter-sort";
import { SIDEBAR_ONE_LIST_GROUP_KEY } from "./sidebar-labels";
import { buildSidebarProjection } from "./sidebar-projection";

function makeWorkspace(
  id: string,
  statusBucket: SidebarWorkspaceEntry["statusBucket"] = "done",
  labels: string[] = [],
  projectViewKey = "project",
) {
  const placement: SidebarWorkspacePlacement = {
    workspaceKey: `srv:${id}`,
    serverId: "srv",
    workspaceId: id,
    projectViewKey,
    projectName: "Project",
    projectKind: "git",
    workspaceKind: "worktree",
    name: id,
  };
  const entry: SidebarWorkspaceEntry = {
    ...placement,
    workspaceDirectory: "",
    workspaceDirectoryLabel: "",
    title: null,
    currentBranch: null,
    statusBucket,
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: null,
    prHint: null,
    archiveHasUncommittedChanges: null,
    archiveUnpushedCommitCount: null,
    scripts: [],
    hasRunningScripts: false,
    labels,
  };
  return { placement, entry };
}

function makeProject(
  workspaces: SidebarWorkspacePlacement[],
  viewKey = "project",
): SidebarProjectEntry {
  return {
    viewKey,
    projectName: "Project",
    projectKind: "git",
    iconWorkingDir: `/repo/${viewKey}`,
    hosts: [
      {
        serverId: "srv",
        projectId: viewKey,
        iconWorkingDir: `/repo/${viewKey}`,
        worktreeSupport: "supported" as const,
      },
    ],
    workspaces,
  };
}

function projectionInput(options?: { groupMode?: SidebarGroupMode; pinnedCollapsed?: boolean }) {
  const pinned = makeWorkspace("pinned", "running");
  const unpinned = makeWorkspace("unpinned", "needs_input");
  return {
    projects: [makeProject([pinned.placement, unpinned.placement])],
    pinnedKeys: {
      pinnedWorkspaceKeys: [pinned.placement.workspaceKey],
      pinnedAtByKey: { [pinned.placement.workspaceKey]: "2026-07-12T12:00:00.000Z" },
    },
    pinnedWorkspaceOrder: [],
    workspaceEntriesByKey: new Map([
      [pinned.entry.workspaceKey, pinned.entry],
      [unpinned.entry.workspaceKey, unpinned.entry],
    ]),
    projectNamesByViewKey: new Map([["project", "Project"]]),
    groupMode: options?.groupMode ?? ("project" as SidebarGroupMode),
    pinnedCollapsed: options?.pinnedCollapsed ?? false,
    collapsedProjectKeys: new Set<string>(),
    collapsedWorkspaceGroupKeys: new Set<string>(),
  };
}

/**
 * Two projects, one workspace each, both labelled — so every grouping mode puts rows from more
 * than one project on screen, and a mode that asked for fewer icons than it renders would show it.
 */
function twoProjectInput(groupMode: SidebarGroupMode) {
  const first = makeWorkspace("first", "running", ["Urgent"], "project");
  const second = makeWorkspace("second", "needs_input", ["Backend"], "other-project");
  return {
    ...projectionInput({ groupMode }),
    projects: [makeProject([first.placement]), makeProject([second.placement], "other-project")],
    pinnedKeys: { pinnedWorkspaceKeys: [], pinnedAtByKey: {} },
    workspaceEntriesByKey: new Map([
      [first.entry.workspaceKey, first.entry],
      [second.entry.workspaceKey, second.entry],
    ]),
    projectNamesByViewKey: new Map([
      ["project", "Project"],
      ["other-project", "Other project"],
    ]),
  };
}

describe("buildSidebarProjection", () => {
  // The rule that outlived the bug it was written for: a project icon is fetched per project, so
  // whatever a mode groups by, the rows it produces can only reference projects already covered.
  for (const groupMode of ["project", "status", "list"] as const) {
    it(`covers every row ${groupMode} grouping renders with a project icon target`, () => {
      const projection = buildSidebarProjection(twoProjectInput(groupMode));
      const covered = new Set(projection.projectIconTargets.map((target) => target.projectViewKey));

      // Every leading visual the sidebar can paint from this projection: pinned rows, grouped
      // rows, project headers and the rows under them.
      const renderedProjectViewKeys = new Set<string>();
      for (const entry of projection.pinnedGroups.pinnedChats) {
        renderedProjectViewKeys.add(entry.projectViewKey);
      }
      for (const group of projection.workspaceGroups) {
        for (const entry of group.rows) renderedProjectViewKeys.add(entry.projectViewKey);
      }
      for (const project of projection.pinnedGroups.unpinnedProjects) {
        renderedProjectViewKeys.add(project.viewKey);
        for (const entry of project.workspaces) renderedProjectViewKeys.add(entry.projectViewKey);
      }

      expect([...renderedProjectViewKeys].sort()).toEqual(["other-project", "project"]);
      expect([...renderedProjectViewKeys].filter((viewKey) => !covered.has(viewKey))).toEqual([]);
    });
  }

  it("uses one pin-aware projection for project rows and shortcut order", () => {
    const projection = buildSidebarProjection(projectionInput());

    expect(projection.pinnedGroups.pinnedChats.map((entry) => entry.workspaceId)).toEqual([
      "pinned",
    ]);
    const remainingProject = projection.pinnedGroups.unpinnedProjects[0];
    expect(remainingProject?.workspaces.map((entry) => entry.workspaceId)).toEqual(["unpinned"]);
    expect(projection.shortcutModel.shortcutTargets).toEqual([
      { serverId: "srv", workspaceId: "pinned" },
      { serverId: "srv", workspaceId: "unpinned" },
    ]);
  });

  it("keeps pinned chats above status groups and removes them from those groups", () => {
    const projection = buildSidebarProjection(projectionInput({ groupMode: "status" }));

    expect(projection.workspaceGroups.map((group) => group.key)).toEqual(["needs_input"]);
    expect(projection.workspaceGroups[0]?.rows.map((entry) => entry.workspaceId)).toEqual([
      "unpinned",
    ]);
    expect(projection.shortcutModel.shortcutTargets).toEqual([
      { serverId: "srv", workspaceId: "pinned" },
      { serverId: "srv", workspaceId: "unpinned" },
    ]);
  });

  it("does not number pinned chats while the pinned section is collapsed", () => {
    const projection = buildSidebarProjection(
      projectionInput({ groupMode: "status", pinnedCollapsed: true }),
    );

    expect(projection.shortcutModel.shortcutTargets).toEqual([
      { serverId: "srv", workspaceId: "unpinned" },
    ]);
  });

  it("sorts rows within status groups by recent activity when requested", () => {
    const older = makeWorkspace("older", "done");
    const newer = makeWorkspace("newer", "done");
    older.entry.lastActivityAt = new Date("2026-09-20T00:00:00Z");
    newer.entry.lastActivityAt = new Date("2026-09-29T00:00:00Z");
    const input = projectionInput({ groupMode: "status" });
    input.projects = [makeProject([older.placement, newer.placement])];
    input.pinnedKeys = { pinnedWorkspaceKeys: [], pinnedAtByKey: {} };
    input.workspaceEntriesByKey = new Map([
      [older.entry.workspaceKey, older.entry],
      [newer.entry.workspaceKey, newer.entry],
    ]);

    const projection = buildSidebarProjection({ ...input, sortMode: "recent" });
    expect(projection.workspaceGroups[0]?.rows.map((entry) => entry.workspaceId)).toEqual([
      "newer",
      "older",
    ]);
  });
});

describe("buildSidebarProjection in one-list mode", () => {
  /** Three unpinned rows from two projects and three statuses, in a deliberate non-status order. */
  function oneListInput() {
    const pinned = makeWorkspace("pinned", "running");
    const quiet = makeWorkspace("quiet", "done", [], "project");
    const blocked = makeWorkspace("blocked", "needs_input", [], "other-project");
    const busy = makeWorkspace("busy", "running", [], "project");
    return {
      ...projectionInput({ groupMode: "list" }),
      sortMode: "recent" as SidebarSortMode,
      projects: [
        makeProject([pinned.placement, quiet.placement, busy.placement]),
        makeProject([blocked.placement], "other-project"),
      ],
      // The model hands the projection its entries already filtered and sorted; this is that order.
      workspaceEntriesByKey: new Map([
        [pinned.entry.workspaceKey, pinned.entry],
        [quiet.entry.workspaceKey, quiet.entry],
        [blocked.entry.workspaceKey, blocked.entry],
        [busy.entry.workspaceKey, busy.entry],
      ]),
      projectNamesByViewKey: new Map([
        ["project", "Project"],
        ["other-project", "Other project"],
      ]),
    };
  }

  it("puts every unpinned row in one headerless group, keeping the sorted order", () => {
    const projection = buildSidebarProjection(oneListInput());

    expect(projection.workspaceGroups).toHaveLength(1);
    const [group] = projection.workspaceGroups;
    expect(group?.key).toBe(SIDEBAR_ONE_LIST_GROUP_KEY);
    expect(group?.leading).toEqual({ kind: "none" });
    // Not regrouped by status (needs_input would lead) and not by project (busy would follow quiet).
    expect(group?.rows.map((entry) => entry.workspaceId)).toEqual(["quiet", "blocked", "busy"]);
  });

  it("keeps pinned chats above the list and numbers shortcuts in on-screen order", () => {
    const projection = buildSidebarProjection(oneListInput());

    expect(projection.pinnedGroups.pinnedChats.map((entry) => entry.workspaceId)).toEqual([
      "pinned",
    ]);
    expect(projection.shortcutModel.shortcutTargets).toEqual([
      { serverId: "srv", workspaceId: "pinned" },
      { serverId: "srv", workspaceId: "quiet" },
      { serverId: "srv", workspaceId: "blocked" },
      { serverId: "srv", workspaceId: "busy" },
    ]);
  });

  it("ignores a collapsed-group key it has no header to toggle", () => {
    const projection = buildSidebarProjection({
      ...oneListInput(),
      collapsedWorkspaceGroupKeys: new Set([SIDEBAR_ONE_LIST_GROUP_KEY]),
    });

    expect(projection.shortcutModel.shortcutTargets.map((target) => target.workspaceId)).toEqual([
      "pinned",
      "quiet",
      "blocked",
      "busy",
    ]);
  });

  it("renders no group at all when every row is pinned or filtered away", () => {
    const input = oneListInput();
    const projection = buildSidebarProjection({
      ...input,
      workspaceEntriesByKey: new Map(),
    });

    expect(projection.workspaceGroups).toEqual([]);
  });

  it("follows the arranged project order in Manual sort, not the host's model order", () => {
    const input = oneListInput();
    const projection = buildSidebarProjection({
      ...input,
      sortMode: "manual",
      // The person dragged Other project above Project.
      projects: [input.projects[1]!, input.projects[0]!],
    });

    expect(projection.workspaceGroups[0]?.rows.map((entry) => entry.workspaceId)).toEqual([
      "blocked",
      "quiet",
      "busy",
    ]);
  });

  it("keeps the model's sorted order for activity sorts regardless of project order", () => {
    const input = oneListInput();
    const projection = buildSidebarProjection({
      ...input,
      sortMode: "recent",
      projects: [input.projects[1]!, input.projects[0]!],
    });

    expect(projection.workspaceGroups[0]?.rows.map((entry) => entry.workspaceId)).toEqual([
      "quiet",
      "blocked",
      "busy",
    ]);
  });
});
