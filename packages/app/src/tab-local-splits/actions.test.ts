import { describe, expect, it } from "vitest";
import {
  breakOutLeaf,
  cancelChooser,
  closeLeaf,
  fillChooser,
  focusLeaf,
  resizeTabLocalGroup,
  splitTabLocal,
} from "@/tab-local-splits/actions";
import {
  collectLeafTabIds,
  collectLeaves,
  leafIdOf,
  type TabLocalLayouts,
} from "@/tab-local-splits/model";

function idSource(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `id${next}`;
  };
}

function split(
  layouts: TabLocalLayouts,
  hostTabId: string,
  side: "right" | "below",
  createId = idSource(),
) {
  const result = splitTabLocal({ layouts, hostTabId, side, createId });
  if (result.kind !== "split") throw new Error(`refused: ${result.reason}`);
  return result;
}

function leafIds(layouts: TabLocalLayouts, hostTabId: string): string[] {
  const layout = layouts[hostTabId];
  return layout ? collectLeaves(layout.root).map(leafIdOf) : [];
}

describe("splitTabLocal", () => {
  it("turns a plain tab into a composite of the tab and a focused chooser at 50/50", () => {
    const result = split({}, "agent_a", "right");
    expect(result.layouts.agent_a).toEqual({
      hostTabId: "agent_a",
      focusedLeafId: result.chooserId,
      root: {
        kind: "group",
        id: "id2",
        direction: "horizontal",
        sizes: [0.5, 0.5],
        children: [
          { kind: "leaf", tabId: "agent_a" },
          { kind: "chooser", id: result.chooserId },
        ],
      },
    });
  });

  it("splits the focused leaf, nesting across orientations (T layout)", () => {
    const ids = idSource();
    const first = split({}, "agent_a", "right", ids);
    const filled = fillChooser({
      layouts: first.layouts,
      hostTabId: "agent_a",
      chooserId: first.chooserId,
      tabId: "terminal_t",
    });
    const second = split(filled, "agent_a", "below", ids);
    const root = second.layouts.agent_a?.root;
    expect(root?.kind).toBe("group");
    if (root?.kind !== "group") return;
    expect(root.children[0]).toEqual({ kind: "leaf", tabId: "agent_a" });
    expect(root.children[1]).toMatchObject({
      kind: "group",
      direction: "vertical",
      sizes: [0.5, 0.5],
      children: [
        { kind: "leaf", tabId: "terminal_t" },
        { kind: "chooser", id: second.chooserId },
      ],
    });
    expect(second.layouts.agent_a?.focusedLeafId).toBe(second.chooserId);
  });

  it("halves the leaf's share when the parent already splits the same way", () => {
    const ids = idSource();
    const first = split({}, "agent_a", "right", ids);
    const filled = fillChooser({
      layouts: first.layouts,
      hostTabId: "agent_a",
      chooserId: first.chooserId,
      tabId: "terminal_t",
    });
    const second = split(filled, "agent_a", "right", ids);
    const root = second.layouts.agent_a?.root;
    expect(root).toMatchObject({ kind: "group", sizes: [0.5, 0.25, 0.25] });
  });

  it("refuses below the minimum leaf size or past depth 3, with a reason", () => {
    expect(
      splitTabLocal({
        layouts: {},
        hostTabId: "agent_a",
        side: "right",
        createId: idSource(),
        leafSize: { width: 300, height: 600 },
      }),
    ).toEqual({ kind: "refused", reason: "min-size" });
    expect(
      splitTabLocal({
        layouts: {},
        hostTabId: "agent_a",
        side: "below",
        createId: idSource(),
        leafSize: { width: 600, height: 200 },
      }),
    ).toEqual({ kind: "refused", reason: "min-size" });

    const ids = idSource();
    let layouts: TabLocalLayouts = {};
    const sides = ["right", "below", "right"] as const;
    sides.forEach((side, index) => {
      const next = split(layouts, "agent_a", side, ids);
      layouts = fillChooser({
        layouts: next.layouts,
        hostTabId: "agent_a",
        chooserId: next.chooserId,
        tabId: `terminal_${index}`,
      });
    });
    expect(splitTabLocal({ layouts, hostTabId: "agent_a", side: "below", createId: ids })).toEqual({
      kind: "refused",
      reason: "max-depth",
    });
  });
});

describe("fillChooser / cancelChooser", () => {
  it("moves an existing tab into the chooser and focuses it", () => {
    const first = split({}, "agent_a", "right");
    const layouts = fillChooser({
      layouts: first.layouts,
      hostTabId: "agent_a",
      chooserId: first.chooserId,
      tabId: "terminal_t",
    });
    expect(leafIds(layouts, "agent_a")).toEqual(["agent_a", "terminal_t"]);
    expect(layouts.agent_a?.focusedLeafId).toBe("terminal_t");
  });

  it("groups a newly created tab the same way", () => {
    const first = split({}, "agent_a", "below");
    const layouts = fillChooser({
      layouts: first.layouts,
      hostTabId: "agent_a",
      chooserId: first.chooserId,
      tabId: "draft_new",
    });
    expect(layouts.agent_a?.root).toMatchObject({ direction: "vertical" });
    expect(collectLeafTabIds(layouts.agent_a!)).toEqual(["agent_a", "draft_new"]);
  });

  it("moves a member out of its old composite instead of showing it twice", () => {
    const ids = idSource();
    const a = split({}, "agent_a", "right", ids);
    let layouts = fillChooser({
      layouts: a.layouts,
      hostTabId: "agent_a",
      chooserId: a.chooserId,
      tabId: "terminal_t",
    });
    const b = split(layouts, "agent_b", "right", ids);
    layouts = fillChooser({
      layouts: b.layouts,
      hostTabId: "agent_b",
      chooserId: b.chooserId,
      tabId: "terminal_t",
    });
    expect(layouts.agent_a).toBeUndefined();
    expect(leafIds(layouts, "agent_b")).toEqual(["agent_b", "terminal_t"]);
  });

  it("cancel removes the chooser and dissolves a one-leaf composite", () => {
    const first = split({}, "agent_a", "right");
    expect(
      cancelChooser({ layouts: first.layouts, hostTabId: "agent_a", chooserId: first.chooserId }),
    ).toEqual({});
  });
});

describe("closeLeaf", () => {
  function threeLeaves(): TabLocalLayouts {
    const ids = idSource();
    const first = split({}, "agent_a", "right", ids);
    let layouts = fillChooser({
      layouts: first.layouts,
      hostTabId: "agent_a",
      chooserId: first.chooserId,
      tabId: "terminal_t",
    });
    const second = split(layouts, "agent_a", "below", ids);
    layouts = fillChooser({
      layouts: second.layouts,
      hostTabId: "agent_a",
      chooserId: second.chooserId,
      tabId: "browser_b",
    });
    return layouts;
  }

  it("collapses single-child groups", () => {
    const layouts = closeLeaf({
      layouts: threeLeaves(),
      hostTabId: "agent_a",
      leafId: "browser_b",
    });
    expect(layouts.agent_a?.root).toEqual({
      kind: "group",
      id: "id2",
      direction: "horizontal",
      sizes: [0.5, 0.5],
      children: [
        { kind: "leaf", tabId: "agent_a" },
        { kind: "leaf", tabId: "terminal_t" },
      ],
    });
  });

  it("dissolves at one leaf", () => {
    const layouts = closeLeaf({
      layouts: threeLeaves(),
      hostTabId: "agent_a",
      leafId: "browser_b",
    });
    expect(closeLeaf({ layouts, hostTabId: "agent_a", leafId: "terminal_t" })).toEqual({});
  });

  it("promotes the first remaining leaf when the host closes", () => {
    const layouts = closeLeaf({ layouts: threeLeaves(), hostTabId: "agent_a", leafId: "agent_a" });
    expect(layouts.agent_a).toBeUndefined();
    expect(layouts.terminal_t?.hostTabId).toBe("terminal_t");
    expect(leafIds(layouts, "terminal_t")).toEqual(["terminal_t", "browser_b"]);
  });
});

describe("breakOutLeaf / focusLeaf / resizeTabLocalGroup", () => {
  it("removes the member and reports the strip slot right of the host", () => {
    const first = split({}, "agent_a", "right");
    const layouts = fillChooser({
      layouts: first.layouts,
      hostTabId: "agent_a",
      chooserId: first.chooserId,
      tabId: "terminal_t",
    });
    const result = breakOutLeaf({
      layouts,
      hostTabId: "agent_a",
      leafId: "terminal_t",
      stripTabIds: ["file_x", "agent_a", "agent_z"],
    });
    expect(result.layouts).toEqual({});
    expect(result.insertionIndex).toBe(2);
  });

  it("focuses a leaf and resizes a group with upstream's clamping", () => {
    const first = split({}, "agent_a", "right");
    const focused = focusLeaf({ layouts: first.layouts, hostTabId: "agent_a", leafId: "agent_a" });
    expect(focused.agent_a?.focusedLeafId).toBe("agent_a");
    const resized = resizeTabLocalGroup({
      layouts: focused,
      hostTabId: "agent_a",
      groupId: "id2",
      sizes: [0.98, 0.02],
    });
    expect(resized.agent_a?.root).toMatchObject({ sizes: [0.9, 0.1] });
  });
});
