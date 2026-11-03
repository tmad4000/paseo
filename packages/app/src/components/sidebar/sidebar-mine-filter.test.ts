import { describe, expect, it } from "vitest";
import { filterWorkspacesByMine, isMineSidebarWorkspace } from "./sidebar-mine-filter";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";

function row(id: string, isMine: boolean | undefined, statusBucket: SidebarStateBucket = "done") {
  return { id, isMine, statusBucket };
}

describe("Mine sidebar filter", () => {
  const rows = [
    row("mine", true),
    row("delegated", false),
    row("delegated-running", false, "running"),
    row("delegated-needs-input", false, "needs_input"),
    row("no-activity", undefined),
  ];

  it("shows everything and hides nothing while off", () => {
    expect(filterWorkspacesByMine({ workspaces: rows, mineOnly: false })).toEqual({
      workspaces: rows,
      hiddenCount: 0,
    });
  });

  it("hides delegated workspaces and counts them while on", () => {
    const result = filterWorkspacesByMine({ workspaces: rows, mineOnly: true });
    expect(result.workspaces.map((workspace) => workspace.id)).toEqual([
      "mine",
      "delegated-needs-input",
      "no-activity",
    ]);
    expect(result.hiddenCount).toBe(2);
  });

  it("never hides a workspace that needs input", () => {
    expect(isMineSidebarWorkspace(row("x", false, "needs_input"))).toBe(true);
    expect(isMineSidebarWorkspace(row("x", false, "failed"))).toBe(false);
  });
});
