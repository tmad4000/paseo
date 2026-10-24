import { describe, expect, it } from "vitest";
import type { SidebarGroupMode } from "@/stores/sidebar-view-store";
import type { CommandCenterIconProps } from "./contributions";
import { buildGroupingContributions, type GroupingCommandCenterSource } from "./root-contributions";

function ProjectIcon(_props: CommandCenterIconProps) {
  return null;
}

function StatusIcon(_props: CommandCenterIconProps) {
  return null;
}

function ListIcon(_props: CommandCenterIconProps) {
  return null;
}

function source(groupMode: SidebarGroupMode): {
  value: GroupingCommandCenterSource;
  applied: SidebarGroupMode[];
} {
  const applied: SidebarGroupMode[] = [];
  return {
    value: {
      groupMode,
      labels: {
        section: "Actions",
        groupByProject: "Group by project",
        groupByStatus: "Group by status",
        groupInOneList: "Show chats in one list",
      },
      icons: { project: ProjectIcon, status: StatusIcon, list: ListIcon },
      setGroupMode: (mode) => applied.push(mode),
    },
    applied,
  };
}

function titles(mode: SidebarGroupMode): string[] {
  return buildGroupingContributions(source(mode).value).map((contribution) =>
    contribution.presentation.kind === "action" ? contribution.presentation.title : "",
  );
}

describe("grouping command center contributions", () => {
  it("offers status and one list while grouped by project", () => {
    expect(titles("project")).toEqual(["Group by status", "Show chats in one list"]);
  });

  it("offers project and one list while grouped by status", () => {
    expect(titles("status")).toEqual(["Group by project", "Show chats in one list"]);
  });

  it("offers project and status while shown as one list", () => {
    expect(titles("list")).toEqual(["Group by project", "Group by status"]);
  });

  it("never offers the mode you are already in", () => {
    for (const mode of ["project", "status", "list"] as const) {
      expect(buildGroupingContributions(source(mode).value).map((c) => c.id)).not.toContain(
        `sidebar-grouping-${mode}`,
      );
    }
  });

  it("applies the mode each entry names, with that mode's icon", () => {
    const fixture = source("project");
    const contributions = buildGroupingContributions(fixture.value);
    const list = contributions.find((contribution) => contribution.id === "sidebar-grouping-list");

    expect(list?.presentation).toMatchObject({ icon: ListIcon });
    list?.run();
    expect(fixture.applied).toEqual(["list"]);
  });

  it("keeps each target's id stable across modes so the registry tiebreak never moves", () => {
    const fromProject = buildGroupingContributions(source("project").value);
    const fromStatus = buildGroupingContributions(source("status").value);
    expect(fromProject.find((c) => c.id === "sidebar-grouping-list")).toBeDefined();
    expect(fromStatus.find((c) => c.id === "sidebar-grouping-list")).toBeDefined();
  });

  it("stays out of the default empty-query list", () => {
    for (const mode of ["project", "status", "list"] as const) {
      for (const contribution of buildGroupingContributions(source(mode).value)) {
        expect(contribution.visibility).toBe("query");
        expect(contribution.group).toBe("actions");
        // 6 is keyboard-shortcuts and 7 belongs to the workspace actions in #3013.
        expect(contribution.rank).toBe(8);
      }
    }
  });
});
