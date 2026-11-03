import type { SidebarWorkspaceEntry } from "@/hooks/sidebar-workspaces-view-model";

type MineFilterEntry = Pick<SidebarWorkspaceEntry, "isMine" | "statusBucket">;

/**
 * A workspace the Mine filter keeps: one a person started or talked to, or one that needs input
 * now, whoever started it. Entries without agent activity count as mine.
 */
export function isMineSidebarWorkspace(workspace: MineFilterEntry): boolean {
  return workspace.isMine !== false || workspace.statusBucket === "needs_input";
}

export interface MineFilterResult<T> {
  workspaces: T[];
  /** Rows the filter removed, for the chip's count. Zero while the filter is off. */
  hiddenCount: number;
}

export function filterWorkspacesByMine<T extends MineFilterEntry>(input: {
  workspaces: readonly T[];
  mineOnly: boolean;
}): MineFilterResult<T> {
  if (!input.mineOnly) return { workspaces: [...input.workspaces], hiddenCount: 0 };
  const workspaces = input.workspaces.filter(isMineSidebarWorkspace);
  return { workspaces, hiddenCount: input.workspaces.length - workspaces.length };
}
