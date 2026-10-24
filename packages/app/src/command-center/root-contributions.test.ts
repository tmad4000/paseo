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
    const icons = { project: ProjectIcon, status: StatusIcon, list: ListIcon };
    for (const current of ["project", "status", "list"] as const) {
      const fixture = source(current);
      for (const contribution of buildGroupingContributions(fixture.value)) {
        contribution.run();
        const applied = fixture.applied.at(-1)!;
        expect(applied).not.toBe(current);
        expect(contribution.id).toBe(`sidebar-grouping-${applied}`);
        expect(contribution.presentation).toMatchObject({ icon: icons[applied] });
      }
    }
  });

  it("gives each target the same id from every mode that offers it", () => {
    const idsByTarget = new Map<SidebarGroupMode, Set<string>>();
    for (const current of ["project", "status", "list"] as const) {
      const fixture = source(current);
      for (const contribution of buildGroupingContributions(fixture.value)) {
        contribution.run();
        const target = fixture.applied.at(-1)!;
        const ids = idsByTarget.get(target) ?? new Set<string>();
        ids.add(contribution.id);
        idsByTarget.set(target, ids);
      }
    }
    expect(Object.fromEntries([...idsByTarget].map(([target, ids]) => [target, [...ids]]))).toEqual(
      {
        project: ["sidebar-grouping-project"],
        status: ["sidebar-grouping-status"],
        list: ["sidebar-grouping-list"],
      },
    );
  });

  it("keeps each mode's own words on its own entry only", () => {
    const fromProject = buildGroupingContributions(source("project").value);
    const listEntry = fromProject.find((c) => c.id === "sidebar-grouping-list");
    const statusEntry = fromProject.find((c) => c.id === "sidebar-grouping-status");
    expect(listEntry?.keywords).toEqual(expect.arrayContaining(["group", "list", "flat"]));
    expect(listEntry?.keywords).not.toContain("status");
    expect(statusEntry?.keywords).not.toContain("list");
    for (const contribution of buildGroupingContributions(source("list").value)) {
      expect(contribution.keywords).not.toContain("list");
      expect(contribution.keywords).toContain("group");
    }
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
