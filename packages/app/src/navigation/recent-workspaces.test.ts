import { describe, expect, it } from "vitest";
import {
  buildRecentWorkspaceEntries,
  createRecentWorkspaceComparator,
  initialRecentWorkspaceIndex,
  recentWorkspaceKey,
  stepRecentWorkspaceIndex,
  touchRecentWorkspace,
  type RecentWorkspace,
} from "./recent-workspaces";

function visit(workspaceId: string, visitedAt = 1): RecentWorkspace {
  return { serverId: "server-1", workspaceId, visitedAt };
}

const labels = { title: "title", subtitle: "subtitle" };

describe("recent workspaces", () => {
  it("moves a revisited workspace to the front and caps the list", () => {
    let recent: readonly RecentWorkspace[] = [];
    for (const id of ["a", "b", "c", "b"]) {
      recent = touchRecentWorkspace(recent, visit(id), 3);
    }
    expect(recent.map((entry) => entry.workspaceId)).toEqual(["b", "c", "a"]);

    recent = touchRecentWorkspace(recent, visit("d"), 3);
    expect(recent.map((entry) => entry.workspaceId)).toEqual(["d", "b", "c"]);
  });

  it("leaves the list untouched when the front workspace is visited again", () => {
    const recent = [visit("a"), visit("b")];
    expect(touchRecentWorkspace(recent, visit("a", 99))).toBe(recent);
  });

  it("skips workspaces that no longer resolve and marks the current one", () => {
    const entries = buildRecentWorkspaceEntries({
      recent: [visit("a"), visit("gone"), visit("b")],
      current: { serverId: "server-1", workspaceId: "a" },
      labelsOf: (workspace) => (workspace.workspaceId === "gone" ? null : labels),
    });
    expect(entries.map((entry) => [entry.workspaceId, entry.isCurrent])).toEqual([
      ["a", true],
      ["b", false],
    ]);
  });

  it("starts on the previous workspace from inside one, and on the latest from elsewhere", () => {
    const inside = buildRecentWorkspaceEntries({
      recent: [visit("a"), visit("b"), visit("c")],
      current: { serverId: "server-1", workspaceId: "a" },
      labelsOf: () => labels,
    });
    expect(initialRecentWorkspaceIndex(inside, 1)).toBe(1);
    expect(initialRecentWorkspaceIndex(inside, -1)).toBe(2);

    const elsewhere = buildRecentWorkspaceEntries({
      recent: [visit("a"), visit("b")],
      current: null,
      labelsOf: () => labels,
    });
    expect(initialRecentWorkspaceIndex(elsewhere, 1)).toBe(0);
  });

  it("has nowhere to start when the only recent workspace is the current one", () => {
    const entries = buildRecentWorkspaceEntries({
      recent: [visit("a")],
      current: { serverId: "server-1", workspaceId: "a" },
      labelsOf: () => labels,
    });
    expect(initialRecentWorkspaceIndex(entries, 1)).toBeNull();
  });

  it("wraps when stepping past either end", () => {
    expect(stepRecentWorkspaceIndex(2, 1, 3)).toBe(0);
    expect(stepRecentWorkspaceIndex(0, -1, 3)).toBe(2);
  });

  it("orders pickers by recency, current workspace after other visits, unvisited last", () => {
    const compare = createRecentWorkspaceComparator(
      [visit("current"), visit("previous"), visit("older")],
      recentWorkspaceKey({ serverId: "server-1", workspaceId: "current" }),
    );
    const keys = ["never", "older", "current", "previous"].map((id) =>
      recentWorkspaceKey({ serverId: "server-1", workspaceId: id }),
    );
    expect([...keys].sort(compare).map((key) => key.split(":")[1])).toEqual([
      "previous",
      "older",
      "current",
      "never",
    ]);
  });
});
