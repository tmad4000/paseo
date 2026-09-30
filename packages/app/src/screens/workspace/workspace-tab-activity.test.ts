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
