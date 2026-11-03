import { describe, expect, it } from "vitest";
import {
  focusMovedBehindMaximizedPane,
  hasMultipleVisiblePanes,
  resolveSplitContainerRoot,
  splitNodeContainsPane,
} from "@/components/split-container-focus";
import type { SplitNode } from "@/stores/workspace-layout-store";

const pane = (id: string): SplitNode => ({
  kind: "pane",
  pane: { id, tabIds: [], focusedTabId: null },
});
const hiddenPane = (id: string): SplitNode => ({
  kind: "pane",
  pane: { id, tabIds: [], focusedTabId: null, hidden: true },
});
const root: SplitNode = {
  kind: "group",
  group: {
    id: "root",
    direction: "horizontal",
    children: [pane("left"), pane("right")],
    sizes: [0.5, 0.5],
  },
};

describe("split focus root", () => {
  it("renders only the valid focused pane in focus mode", () => {
    expect(
      resolveSplitContainerRoot({ root, focusedPaneId: "right", focusModeEnabled: true }),
    ).toEqual({ root: pane("right"), usesFallbackStrip: false });
  });

  it("keeps the full tree and reserves the boundary strip when focus is missing", () => {
    expect(
      resolveSplitContainerRoot({ root, focusedPaneId: "missing", focusModeEnabled: true }),
    ).toEqual({ root, usesFallbackStrip: true });
  });

  it("keeps normal splits unclaimed", () => {
    expect(
      resolveSplitContainerRoot({ root, focusedPaneId: "right", focusModeEnabled: false }),
    ).toEqual({ root, usesFallbackStrip: false });
  });

  it("finds the maximized pane without replacing the rendered split tree", () => {
    expect(splitNodeContainsPane(root, "right")).toBe(true);
    expect(splitNodeContainsPane(root, "missing")).toBe(false);
    expect(
      resolveSplitContainerRoot({ root, focusedPaneId: "left", focusModeEnabled: false }),
    ).toEqual({ root, usesFallbackStrip: false });
  });

  it("offers pane maximize only when another pane is visible", () => {
    expect(hasMultipleVisiblePanes(root)).toBe(true);
    expect(hasMultipleVisiblePanes(pane("left"))).toBe(false);
    expect(
      hasMultipleVisiblePanes({
        ...root,
        group: { ...root.group, children: [pane("left"), hiddenPane("right")] },
      }),
    ).toBe(false);
  });
});

describe("focus moving behind a maximized pane", () => {
  const withHidden: SplitNode = {
    kind: "group",
    group: {
      id: "root",
      direction: "horizontal",
      children: [pane("left"), pane("right"), hiddenPane("parked")],
      sizes: [0.4, 0.4, 0.2],
    },
  };
  const moved = (input: {
    maximizedPaneId: string | null;
    previousFocusedPaneId: string | null;
    focusedPaneId: string | null;
    root?: SplitNode | null;
  }) => focusMovedBehindMaximizedPane({ root: withHidden, ...input });

  it("reports Back, a jump or a shortcut landing on a covered pane", () => {
    expect(
      moved({ maximizedPaneId: "left", previousFocusedPaneId: "left", focusedPaneId: "right" }),
    ).toBe(true);
  });

  it("ignores focus that stays on, or returns to, the maximized pane", () => {
    expect(
      moved({ maximizedPaneId: "left", previousFocusedPaneId: "left", focusedPaneId: "left" }),
    ).toBe(false);
    expect(
      moved({ maximizedPaneId: "left", previousFocusedPaneId: "right", focusedPaneId: "left" }),
    ).toBe(false);
  });

  it("does not react to maximize toggling while focus is unchanged", () => {
    expect(
      moved({ maximizedPaneId: "left", previousFocusedPaneId: "right", focusedPaneId: "right" }),
    ).toBe(false);
  });

  it("ignores panes outside the maximizable tree and panes that are hidden anyway", () => {
    expect(
      moved({ maximizedPaneId: "left", previousFocusedPaneId: "left", focusedPaneId: "explorer" }),
    ).toBe(false);
    expect(
      moved({ maximizedPaneId: "left", previousFocusedPaneId: "left", focusedPaneId: "parked" }),
    ).toBe(false);
  });

  it("does nothing when no pane is maximized", () => {
    expect(
      moved({ maximizedPaneId: null, previousFocusedPaneId: "left", focusedPaneId: "right" }),
    ).toBe(false);
    expect(
      moved({
        maximizedPaneId: "left",
        previousFocusedPaneId: "left",
        focusedPaneId: "right",
        root: null,
      }),
    ).toBe(false);
  });
});
