import { describe, expect, it } from "vitest";
import { normalizeLayout, type WorkspaceLayout } from "@/stores/workspace-layout-actions";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import type { TabLocalLayout, TabLocalLayouts } from "@/tab-local-splits/model";
import {
  adoptPendingFills,
  detectTabRetargets,
  normalizeTabLocalLayouts,
  retargetTabLocalLayouts,
} from "@/tab-local-splits/normalize";
import { findAdjacentLeaf, computeTabLocalFrames } from "@/tab-local-splits/geometry";

function targetFor(tabId: string): WorkspaceTabTarget {
  const [kind, id = ""] = tabId.split("_");
  if (kind === "agent") return { kind: "agent", agentId: id };
  if (kind === "terminal") return { kind: "terminal", terminalId: id };
  if (kind === "browser") return { kind: "browser", browserId: id };
  return { kind: "draft", draftId: tabId };
}

function pane(id: string, tabIds: string[], focusedTabId: string | null = tabIds[0] ?? null) {
  return {
    kind: "pane" as const,
    pane: {
      id,
      tabIds,
      focusedTabId,
      tabs: tabIds.map((tabId) => ({ tabId, target: targetFor(tabId), createdAt: 1 })),
    },
  };
}

function layoutOf(...panes: ReturnType<typeof pane>[]): WorkspaceLayout {
  const root =
    panes.length === 1
      ? panes[0]
      : {
          kind: "group" as const,
          group: {
            id: "g",
            direction: "horizontal" as const,
            children: panes,
            sizes: panes.map(() => 1 / panes.length),
          },
        };
  return normalizeLayout({ root, focusedPaneId: panes[0]?.pane.id ?? null });
}

function composite(hostTabId: string, memberTabIds: string[], focusedLeafId = hostTabId) {
  const tabIds = [hostTabId, ...memberTabIds];
  return {
    hostTabId,
    focusedLeafId,
    root: {
      kind: "group" as const,
      id: `group-${hostTabId}`,
      direction: "horizontal" as const,
      children: tabIds.map((tabId) => ({ kind: "leaf" as const, tabId })),
      sizes: tabIds.map(() => 1 / tabIds.length),
    },
  } satisfies TabLocalLayout;
}

describe("normalizeTabLocalLayouts", () => {
  it("is a fixed point for a well-formed composite", () => {
    const layouts: TabLocalLayouts = { agent_a: composite("agent_a", ["terminal_t"]) };
    const result = normalizeTabLocalLayouts({
      layout: layoutOf(pane("main", ["agent_a", "terminal_t", "agent_z"])),
      layouts,
      explorerPaneId: null,
    });
    expect(result).toEqual({ layouts, moves: [], reorders: [], focusRedirects: [] });
    expect(result.layouts).toBe(layouts);
  });

  it("plans moving a member that sits in another pane back to its host's pane", () => {
    const result = normalizeTabLocalLayouts({
      layout: layoutOf(pane("left", ["terminal_t"]), pane("right", ["agent_a"])),
      layouts: { agent_a: composite("agent_a", ["terminal_t"]) },
      explorerPaneId: null,
    });
    expect(result.moves).toEqual([{ tabId: "terminal_t", toPaneId: "right" }]);
  });

  it("drops a member missing from the workspace layout and dissolves the one-leaf tree", () => {
    const result = normalizeTabLocalLayouts({
      layout: layoutOf(pane("main", ["agent_a"])),
      layouts: { agent_a: composite("agent_a", ["terminal_gone"]) },
      explorerPaneId: null,
    });
    expect(result.layouts).toEqual({});
  });

  it("redirects focus on a member to its host, with that leaf focused", () => {
    const result = normalizeTabLocalLayouts({
      layout: layoutOf(pane("main", ["agent_a", "terminal_t"], "terminal_t")),
      layouts: { agent_a: composite("agent_a", ["terminal_t"]) },
      explorerPaneId: null,
    });
    expect(result.focusRedirects).toEqual([{ paneId: "main", hostTabId: "agent_a" }]);
    expect(result.layouts.agent_a?.focusedLeafId).toBe("terminal_t");
  });

  it("keeps a tab referenced by two composites in the first and drops it from the second", () => {
    const result = normalizeTabLocalLayouts({
      layout: layoutOf(pane("main", ["agent_a", "agent_b", "terminal_t", "terminal_u"])),
      layouts: {
        agent_a: composite("agent_a", ["terminal_t"]),
        agent_b: composite("agent_b", ["terminal_t", "terminal_u"]),
      },
      explorerPaneId: null,
    });
    expect(result.layouts.agent_a?.root).toMatchObject({
      children: [
        { kind: "leaf", tabId: "agent_a" },
        { kind: "leaf", tabId: "terminal_t" },
      ],
    });
    expect(result.layouts.agent_b?.root).toMatchObject({
      children: [
        { kind: "leaf", tabId: "agent_b" },
        { kind: "leaf", tabId: "terminal_u" },
      ],
    });
  });

  it("promotes the first remaining leaf when the host tab is gone", () => {
    const result = normalizeTabLocalLayouts({
      layout: layoutOf(pane("main", ["terminal_t", "terminal_u"])),
      layouts: { agent_a: composite("agent_a", ["terminal_t", "terminal_u"]) },
      explorerPaneId: null,
    });
    expect(Object.keys(result.layouts)).toEqual(["terminal_t"]);
    expect(result.layouts.terminal_t?.hostTabId).toBe("terminal_t");
  });

  it("keeps members contiguous right after their host", () => {
    const result = normalizeTabLocalLayouts({
      layout: layoutOf(pane("main", ["terminal_t", "agent_z", "agent_a"])),
      layouts: { agent_a: composite("agent_a", ["terminal_t"]) },
      explorerPaneId: null,
    });
    expect(result.reorders).toEqual([
      { paneId: "main", tabIds: ["agent_z", "agent_a", "terminal_t"] },
    ]);
  });

  it("dissolves a composite whose host landed in the Explorer pane", () => {
    const result = normalizeTabLocalLayouts({
      layout: layoutOf(pane("main", ["agent_z"]), pane("explorer", ["agent_a", "terminal_t"])),
      layouts: { agent_a: composite("agent_a", ["terminal_t"]) },
      explorerPaneId: "explorer",
    });
    expect(result.layouts).toEqual({});
  });
});

describe("retargets and pending fills", () => {
  it("follows a draft that became an agent in the same slot", () => {
    const before = layoutOf(pane("main", ["agent_a", "draft_1"]));
    const after = layoutOf(pane("main", ["agent_a", "agent_new"]));
    const retargets = detectTabRetargets(before, after);
    expect([...retargets]).toEqual([["draft_1", "agent_new"]]);
    const layouts = retargetTabLocalLayouts(
      { agent_a: composite("agent_a", ["draft_1"], "draft_1") },
      retargets,
    );
    expect(layouts.agent_a?.focusedLeafId).toBe("agent_new");
    expect(layouts.agent_a?.root).toMatchObject({
      children: [
        { kind: "leaf", tabId: "agent_a" },
        { kind: "leaf", tabId: "agent_new" },
      ],
    });
  });

  it("does not treat a reorder as a retarget", () => {
    const before = layoutOf(pane("main", ["agent_a", "terminal_t"]));
    const after = layoutOf(pane("main", ["terminal_t", "agent_a"]));
    expect(detectTabRetargets(before, after).size).toBe(0);
  });

  it("fills a waiting chooser with the first new tab of the requested kind", () => {
    const layouts: TabLocalLayouts = {
      agent_a: {
        hostTabId: "agent_a",
        focusedLeafId: "chooser:1",
        root: {
          kind: "group",
          id: "g1",
          direction: "horizontal",
          sizes: [0.5, 0.5],
          children: [
            { kind: "leaf", tabId: "agent_a" },
            { kind: "chooser", id: "chooser:1" },
          ],
        },
      },
    };
    const pending = [
      {
        hostTabId: "agent_a",
        chooserId: "chooser:1",
        kind: "terminal" as const,
        knownTabIds: ["agent_a", "terminal_old"],
      },
    ];
    const waiting = adoptPendingFills({
      layout: layoutOf(pane("main", ["agent_a", "terminal_old", "agent_other"])),
      layouts,
      pending,
    });
    expect(waiting).toEqual({ layouts, pending });

    const adopted = adoptPendingFills({
      layout: layoutOf(pane("main", ["agent_a", "terminal_old", "terminal_new"])),
      layouts,
      pending,
    });
    expect(adopted.pending).toEqual([]);
    expect(adopted.layouts.agent_a?.root).toMatchObject({
      children: [
        { kind: "leaf", tabId: "agent_a" },
        { kind: "leaf", tabId: "terminal_new" },
      ],
    });
  });
});

describe("geometry", () => {
  const root = {
    kind: "group" as const,
    id: "g1",
    direction: "horizontal" as const,
    sizes: [0.5, 0.5],
    children: [
      { kind: "leaf" as const, tabId: "agent_a" },
      {
        kind: "group" as const,
        id: "g2",
        direction: "vertical" as const,
        sizes: [0.5, 0.5],
        children: [
          { kind: "leaf" as const, tabId: "terminal_t" },
          { kind: "leaf" as const, tabId: "browser_b" },
        ],
      },
    ],
  };

  it("lays out leaves and dividers as flat fractional frames", () => {
    const frames = computeTabLocalFrames(root);
    expect(frames.leaves).toEqual([
      { leafId: "agent_a", rect: { left: 0, top: 0, width: 0.5, height: 1 } },
      { leafId: "terminal_t", rect: { left: 0.5, top: 0, width: 0.5, height: 0.5 } },
      { leafId: "browser_b", rect: { left: 0.5, top: 0.5, width: 0.5, height: 0.5 } },
    ]);
    expect(frames.dividers.map(({ groupId, offset }) => [groupId, offset])).toEqual([
      ["g1", 0.5],
      ["g2", 0.5],
    ]);
  });

  it("walks to the spatial neighbour and stops at the composite's edge", () => {
    // Both right-hand leaves touch the agent's edge equally; upstream's pane tie-break decides.
    expect(["terminal_t", "browser_b"]).toContain(findAdjacentLeaf(root, "agent_a", "right"));
    expect(findAdjacentLeaf(root, "terminal_t", "down")).toBe("browser_b");
    expect(findAdjacentLeaf(root, "browser_b", "left")).toBe("agent_a");
    expect(findAdjacentLeaf(root, "agent_a", "left")).toBeNull();
  });
});
