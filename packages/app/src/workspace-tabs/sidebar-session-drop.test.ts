import { describe, expect, it } from "vitest";
import {
  planSidebarSessionDrop,
  resolveLastActiveWorkspaceAgent,
  resolveSidebarDropZone,
} from "./sidebar-session-drop";

describe("resolveSidebarDropZone", () => {
  const paneRect = { left: 100, top: 0, width: 1000, height: 800 };
  const tabsRect = { left: 100, top: 0, width: 1000, height: 40 };

  it("reports the tab strip before the edge zones it overlaps", () => {
    expect(resolveSidebarDropZone({ paneRect, tabsRect, x: 120, y: 20 })).toBe("tabs");
  });

  it("uses the pane edge zones below the tab strip", () => {
    expect(resolveSidebarDropZone({ paneRect, tabsRect, x: 1080, y: 400 })).toBe("right");
    expect(resolveSidebarDropZone({ paneRect, tabsRect, x: 110, y: 400 })).toBe("left");
    expect(resolveSidebarDropZone({ paneRect, tabsRect, x: 600, y: 790 })).toBe("bottom");
    expect(resolveSidebarDropZone({ paneRect, tabsRect, x: 600, y: 400 })).toBe("center");
  });

  it("is null outside the pane", () => {
    expect(resolveSidebarDropZone({ paneRect, tabsRect: null, x: 50, y: 400 })).toBeNull();
  });
});

describe("resolveLastActiveWorkspaceAgent", () => {
  it("picks the most recently active, unarchived session of that workspace", () => {
    const agents = [
      { id: "old", workspaceId: "w1", lastActivityAt: new Date("2026-11-01T10:00:00Z") },
      { id: "new", workspaceId: "w1", lastActivityAt: new Date("2026-11-02T10:00:00Z") },
      {
        id: "archived",
        workspaceId: "w1",
        lastActivityAt: new Date("2026-11-03T10:00:00Z"),
        archivedAt: new Date("2026-11-03T11:00:00Z"),
      },
      { id: "elsewhere", workspaceId: "w2", lastActivityAt: new Date("2026-11-04T10:00:00Z") },
    ];
    expect(resolveLastActiveWorkspaceAgent(agents, "w1")?.id).toBe("new");
  });

  it("is null when the workspace has no live session", () => {
    expect(resolveLastActiveWorkspaceAgent([{ id: "a", workspaceId: "w2" }], "w1")).toBeNull();
  });
});

describe("planSidebarSessionDrop", () => {
  const base = { paneId: "p1", layoutWorkspaceId: "here" };

  it("splits and pins a session from another workspace on an edge", () => {
    expect(
      planSidebarSessionDrop({
        ...base,
        zone: "right",
        existingTabId: null,
        homeWorkspaceId: "there",
      }),
    ).toEqual({ kind: "split-and-open", paneId: "p1", position: "right", pin: true });
  });

  it("opens a tab, unpinned, for this workspace's own session on the tab strip or center", () => {
    for (const zone of ["tabs", "center"] as const) {
      expect(
        planSidebarSessionDrop({ ...base, zone, existingTabId: null, homeWorkspaceId: "here" }),
      ).toEqual({ kind: "open-tab", paneId: "p1", pin: false });
    }
  });

  it("moves a session that already has a tab instead of duplicating it", () => {
    expect(
      planSidebarSessionDrop({ ...base, zone: "tabs", existingTabId: "t1", homeWorkspaceId: "x" }),
    ).toEqual({ kind: "move-tab", tabId: "t1", paneId: "p1" });
    expect(
      planSidebarSessionDrop({
        ...base,
        zone: "bottom",
        existingTabId: "t1",
        homeWorkspaceId: "x",
      }),
    ).toEqual({ kind: "split-with-tab", tabId: "t1", paneId: "p1", position: "bottom" });
  });
});
