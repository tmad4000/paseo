import { describe, expect, it } from "vitest";
import type { WorkspaceTabDescriptor } from "./workspace-tabs-types";
import { reconcileTabActivity, sortTabsByActivity } from "./workspace-tab-activity";

function agentTab(id: string): WorkspaceTabDescriptor {
  return { key: id, tabId: id, kind: "agent", target: { kind: "agent", agentId: id } };
}

const tabs = [agentTab("a"), agentTab("b"), agentTab("c")];

describe("workspace tab activity", () => {
  it("marks only background activity unread and clears it on visit", () => {
    const baseline = reconcileTabActivity(
      new Map(),
      tabs,
      new Map([
        ["a", 10],
        ["b", 10],
      ]),
      new Set(["a"]),
    );
    expect([...baseline.values()].map((state) => state.unread)).toEqual([false, false, false]);

    const changed = reconcileTabActivity(
      baseline,
      tabs,
      new Map([
        ["a", 20],
        ["b", 20],
      ]),
      new Set(["a"]),
    );
    expect(changed.get("a")?.unread).toBe(false);
    expect(changed.get("b")?.unread).toBe(true);

    const visited = reconcileTabActivity(
      changed,
      tabs,
      new Map([
        ["a", 20],
        ["b", 20],
      ]),
      new Set(["b"]),
    );
    expect(visited.get("b")?.unread).toBe(false);
    expect(
      reconcileTabActivity(visited, tabs, new Map([["b", 20]]), new Set(["a"])).get("b")?.unread,
    ).toBe(false);
  });

  describe("with explicit reads", () => {
    const explicit = (readThrough: [string, number][] = []) => ({
      viewingMarksRead: false,
      readThroughByAgentId: new Map(readThrough),
    });
    const at = (time: number) =>
      new Map([
        ["a", time],
        ["b", time],
      ]);

    it("keeps an unread tab unread after it is opened", () => {
      const baseline = reconcileTabActivity(new Map(), tabs, at(10), new Set(["a"]), explicit());
      const moved = reconcileTabActivity(baseline, tabs, at(20), new Set(["a"]), explicit());
      expect(moved.get("b")?.unread).toBe(true);

      const opened = reconcileTabActivity(moved, tabs, at(20), new Set(["b"]), explicit());
      expect(opened.get("b")?.unread).toBe(true);
      const left = reconcileTabActivity(opened, tabs, at(20), new Set(["a"]), explicit());
      expect(left.get("b")?.unread).toBe(true);
    });

    it("does not raise the dot for activity seen while the tab is open", () => {
      const baseline = reconcileTabActivity(new Map(), tabs, at(10), new Set(["a"]), explicit());
      const watched = reconcileTabActivity(baseline, tabs, at(20), new Set(["a"]), explicit());
      expect(watched.get("a")?.unread).toBe(false);
    });

    it("clears on an explicit read and comes back with newer activity", () => {
      const baseline = reconcileTabActivity(new Map(), tabs, at(10), new Set(["a"]), explicit());
      const moved = reconcileTabActivity(baseline, tabs, at(20), new Set(["a"]), explicit());
      const read = reconcileTabActivity(moved, tabs, at(20), new Set(["b"]), explicit([["b", 20]]));
      expect(read.get("b")?.unread).toBe(false);

      const again = reconcileTabActivity(read, tabs, at(30), new Set(["a"]), explicit([["b", 20]]));
      expect(again.get("b")?.unread).toBe(true);
    });

    it("lets an explicit read clear a background tab in the legacy mode too", () => {
      const legacy = (readThrough: [string, number][]) => ({
        viewingMarksRead: true,
        readThroughByAgentId: new Map(readThrough),
      });
      const baseline = reconcileTabActivity(new Map(), tabs, at(10), new Set(["a"]), legacy([]));
      const moved = reconcileTabActivity(baseline, tabs, at(20), new Set(["a"]), legacy([]));
      expect(moved.get("b")?.unread).toBe(true);
      const read = reconcileTabActivity(moved, tabs, at(20), new Set(["a"]), legacy([["b", 20]]));
      expect(read.get("b")?.unread).toBe(false);
    });
  });

  it("orders recent agent tabs first and preserves ties and missing timestamps", () => {
    const items = tabs.map((tab) => ({ tab }));
    expect(
      sortTabsByActivity(
        items,
        new Map([
          ["b", 20],
          ["c", 20],
          ["a", 10],
        ]),
      ).map(({ tab }) => tab.tabId),
    ).toEqual(["b", "c", "a"]);
    expect(sortTabsByActivity(items, new Map()).map(({ tab }) => tab.tabId)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});
