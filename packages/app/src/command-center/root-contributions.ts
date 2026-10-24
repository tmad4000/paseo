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

// Shared words find every grouping entry; each entry's own words find only it, so typing "list"
// in list mode does not offer project and status as if they were list modes.
const SHARED_GROUPING_KEYWORDS = ["group", "grouping", "sidebar", "sort"] as const;
const GROUPING_KEYWORDS: Record<SidebarGroupMode, readonly string[]> = {
  project: ["project", "projects"],
  status: ["status", "state"],
  list: ["list", "one list", "flat", "ungrouped", "recent", "activity"],
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
    keywords: [...SHARED_GROUPING_KEYWORDS, ...GROUPING_KEYWORDS[target]],
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
