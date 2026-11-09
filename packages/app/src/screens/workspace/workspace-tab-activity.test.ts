import { describe, expect, it } from "vitest";
import type { WorkspaceTabDescriptor } from "./workspace-tabs-types";
import {
  agentSeenClock,
  collectUnreadTabStates,
  reconcileTabActivity,
  sortTabsByActivity,
} from "./workspace-tab-activity";

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
    const explicit = (readThrough: [string, number][] = [], attention: string[] = []) => ({
      viewingMarksRead: false,
      readThroughByAgentId: new Map(readThrough),
      attentionAgentIds: new Set(attention),
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

    it("shows host attention on a strip that was not mounted when it arrived (cold start)", () => {
      const cold = reconcileTabActivity(
        new Map(),
        tabs,
        at(20),
        new Set(["a"]),
        explicit([], ["b"]),
      );
      expect(cold.get("b")?.unread).toBe(true);
      expect(cold.get("c")?.unread).toBe(false);
    });

    it("keeps the open tab's host attention until it is read, then raises it again", () => {
      const open = reconcileTabActivity(
        new Map(),
        tabs,
        at(20),
        new Set(["b"]),
        explicit([], ["b"]),
      );
      expect(open.get("b")?.unread).toBe(true);
      // The host clears attention on the explicit read, and the read mark covers the activity.
      const read = reconcileTabActivity(open, tabs, at(20), new Set(["b"]), explicit([["b", 20]]));
      expect(read.get("b")?.unread).toBe(false);
      const finishedAgain = reconcileTabActivity(
        read,
        tabs,
        at(30),
        new Set(["b"]),
        explicit([["b", 20]], ["b"]),
      );
      expect(finishedAgain.get("b")?.unread).toBe(true);
    });

    it("raises no read dot for attention the host does not count as readable", () => {
      // Permission attention is never in the readable set, so a strip shows no dot for it.
      const permission = reconcileTabActivity(new Map(), tabs, at(20), new Set(["a"]), explicit());
      expect(permission.get("a")?.unread).toBe(false);
      expect(permission.get("b")?.unread).toBe(false);
      expect(permission.get("c")?.unread).toBe(false);
    });

    it("lets an explicit read clear a background tab in the legacy mode too", () => {
      const legacy = (readThrough: [string, number][], attention: string[] = []) => ({
        viewingMarksRead: true,
        readThroughByAgentId: new Map(readThrough),
        attentionAgentIds: new Set(attention),
      });
      const baseline = reconcileTabActivity(new Map(), tabs, at(10), new Set(["a"]), legacy([]));
      const moved = reconcileTabActivity(baseline, tabs, at(20), new Set(["a"]), legacy([]));
      expect(moved.get("b")?.unread).toBe(true);
      const read = reconcileTabActivity(moved, tabs, at(20), new Set(["a"]), legacy([["b", 20]]));
      expect(read.get("b")?.unread).toBe(false);
    });

    it("never dots the on-screen tab in the legacy mode, even with host attention", () => {
      const legacy = {
        viewingMarksRead: true,
        readThroughByAgentId: new Map(),
        attentionAgentIds: new Set(["a", "b"]),
      };
      const state = reconcileTabActivity(new Map(), tabs, at(20), new Set(["a"]), legacy);
      expect(state.get("a")?.unread).toBe(false);
      expect(state.get("b")?.unread).toBe(true);
    });
  });

  describe("seen vs read", () => {
    const policy = (
      input: {
        seen?: [string, number][];
        read?: [string, number][];
        attention?: [string, number][];
        legacy?: boolean;
      } = {},
    ) => ({
      viewingMarksRead: input.legacy ?? false,
      readThroughByAgentId: new Map(input.read ?? []),
      attentionAgentIds: new Set((input.attention ?? []).map(([id]) => id)),
      seenThroughByAgentId: new Map(input.seen ?? []),
    });
    const at = (time: number) =>
      new Map([
        ["a", time],
        ["b", time],
      ]);
    const onA = new Set(["a"]);
    const onB = new Set(["b"]);

    it("starts background activity as new, with a filled badge", () => {
      const baseline = reconcileTabActivity(new Map(), tabs, at(10), onA, policy());
      const moved = reconcileTabActivity(baseline, tabs, at(20), onA, policy());
      expect(moved.get("b")?.readState).toBe("new");
      expect(moved.get("a")?.readState).toBe("read");
      expect(moved.get("c")?.readState).toBe("read");
    });

    it("does not count a visit as seen until the tab dwells (Ctrl+Tab flick-through)", () => {
      const baseline = reconcileTabActivity(new Map(), tabs, at(10), onA, policy());
      const moved = reconcileTabActivity(baseline, tabs, at(20), onA, policy());
      const flicked = reconcileTabActivity(moved, tabs, at(20), onB, policy());
      expect(flicked.get("b")?.readState).toBe("new");
      const dwelled = reconcileTabActivity(flicked, tabs, at(20), onB, policy(), onB);
      expect(dwelled.get("b")?.readState).toBe("seen");
      expect(dwelled.get("b")?.unread).toBe(true);
    });

    it("stays seen after leaving the tab, through this device's seen mark", () => {
      const baseline = reconcileTabActivity(new Map(), tabs, at(10), onA, policy());
      const moved = reconcileTabActivity(baseline, tabs, at(20), onA, policy());
      const left = reconcileTabActivity(moved, tabs, at(20), onA, policy({ seen: [["b", 20]] }));
      expect(left.get("b")?.readState).toBe("seen");
    });

    it("goes back to new when activity lands after the seen mark", () => {
      const baseline = reconcileTabActivity(new Map(), tabs, at(10), onA, policy());
      const moved = reconcileTabActivity(baseline, tabs, at(20), onA, policy());
      const seen = reconcileTabActivity(moved, tabs, at(20), onA, policy({ seen: [["b", 20]] }));
      const again = reconcileTabActivity(seen, tabs, at(30), onA, policy({ seen: [["b", 20]] }));
      expect(again.get("b")?.readState).toBe("new");
    });

    it("keeps seen through a Mark as unread: read and seen are independent layers", () => {
      // Seen through 20; the host then stamps fresh attention (Mark as unread) without new activity.
      const seen = reconcileTabActivity(
        new Map(),
        tabs,
        at(20),
        onA,
        policy({ seen: [["b", 20]], attention: [["b", 25]] }),
      );
      expect(seen.get("b")?.unread).toBe(true);
      expect(seen.get("b")?.readState).toBe("seen");
      const markedUnread = reconcileTabActivity(
        seen,
        tabs,
        at(20),
        onA,
        policy({ seen: [["b", 20]], attention: [["b", 40]] }),
      );
      expect(markedUnread.get("b")?.unread).toBe(true);
      expect(markedUnread.get("b")?.readState).toBe("seen");
    });

    it("unread by hand but never seen on this device stays new", () => {
      const marked = reconcileTabActivity(
        new Map(),
        tabs,
        at(20),
        onA,
        policy({ attention: [["b", 40]] }),
      );
      expect(marked.get("b")?.readState).toBe("new");
    });

    it("shows a finish watched on screen as seen, not new, without a filled flash", () => {
      const watching = reconcileTabActivity(new Map(), tabs, at(10), onA, policy(), onA);
      const finished = reconcileTabActivity(
        watching,
        tabs,
        at(20),
        onA,
        policy({ attention: [["a", 20]] }),
        onA,
      );
      expect(finished.get("a")?.readState).toBe("seen");
    });

    it("seen never clears host attention or read status: only an explicit read does", () => {
      const seen = reconcileTabActivity(
        new Map(),
        tabs,
        at(20),
        onA,
        policy({ seen: [["b", 20]], attention: [["b", 20]] }),
      );
      expect(seen.get("b")?.unread).toBe(true);
      const read = reconcileTabActivity(
        seen,
        tabs,
        at(20),
        onA,
        policy({ seen: [["b", 20]], read: [["b", 20]] }),
      );
      expect(read.get("b")?.readState).toBe("read");
      expect(read.get("b")?.unread).toBe(false);
    });

    it("never shows the seen level in the legacy read-on-open mode", () => {
      const baseline = reconcileTabActivity(new Map(), tabs, at(10), onA, policy({ legacy: true }));
      const moved = reconcileTabActivity(baseline, tabs, at(20), onA, policy({ legacy: true }));
      const marked = reconcileTabActivity(
        moved,
        tabs,
        at(20),
        onA,
        policy({ legacy: true, seen: [["b", 20]] }),
        onB,
      );
      expect(marked.get("b")?.readState).toBe("new");
      const visited = reconcileTabActivity(
        marked,
        tabs,
        at(20),
        onB,
        policy({ legacy: true }),
        onB,
      );
      expect(visited.get("b")?.readState).toBe("read");
    });

    it("collects only unread tabs, keyed to their level", () => {
      const baseline = reconcileTabActivity(new Map(), tabs, at(10), onA, policy());
      const moved = reconcileTabActivity(
        baseline,
        tabs,
        at(20),
        onA,
        policy({ attention: [["a", 20]], seen: [["a", 20]] }),
      );
      const unread = collectUnreadTabStates(moved);
      expect([...unread]).toEqual([
        ["a", "seen"],
        ["b", "new"],
      ]);
      expect(unread.has("c")).toBe(false);
    });

    it("measures seen against activity only", () => {
      expect(agentSeenClock(10)).toBe(10);
      expect(agentSeenClock(40)).toBe(40);
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
