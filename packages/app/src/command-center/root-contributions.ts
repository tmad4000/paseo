import { SIDEBAR_GROUP_MODES, type SidebarGroupMode } from "@/stores/sidebar-view-store";
import type { CommandCenterContribution, CommandCenterIcon } from "./contributions";

export interface GroupingCommandCenterSource {
  groupMode: SidebarGroupMode;
  labels: {
    section: string;
    groupByProject: string;
    groupByStatus: string;
    groupInOneList: string;
  };
  icons: {
    project?: CommandCenterIcon;
    status?: CommandCenterIcon;
    list?: CommandCenterIcon;
  };
  setGroupMode(mode: SidebarGroupMode): void;
}

const GROUPING_TITLE_KEYS: Record<SidebarGroupMode, keyof GroupingCommandCenterSource["labels"]> = {
  project: "groupByProject",
  status: "groupByStatus",
  list: "groupInOneList",
};

// One entry per mode you are not in, so none of them can ever read as a no-op. Each keeps an id
// derived from its target mode, so the registry tiebreak between them never moves.
export function buildGroupingContributions(
  source: GroupingCommandCenterSource,
): CommandCenterContribution[] {
  return SIDEBAR_GROUP_MODES.filter((mode) => mode !== source.groupMode).map((target) => ({
    id: `sidebar-grouping-${target}`,
    group: "actions",
    groupRank: 0,
    rank: 8,
    keywords: [
      "group",
      "grouping",
      "sort",
      "sidebar",
      "project",
      "status",
      "list",
      "flat",
      "recent",
    ],
    visibility: "query",
    run: () => source.setGroupMode(target),
    presentation: {
      kind: "action",
      title: source.labels[GROUPING_TITLE_KEYS[target]],
      sectionTitle: source.labels.section,
      icon: source.icons[target],
    },
  }));
}
