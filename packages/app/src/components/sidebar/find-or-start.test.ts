import { describe, expect, it } from "vitest";
import { pickUniqueSessionIdMatch } from "./find-or-start";
import type { SidebarTabMatch, SidebarTabMatches } from "./sidebar-filter-matches";

function tab(
  serverId: string,
  workspaceId: string,
  agentId: string,
  title: string,
): SidebarTabMatch {
  return {
    serverId,
    agentId,
    workspaceId,
    workspaceKey: `${serverId}:${workspaceId}`,
    title,
    normalizedTitle: title.toLowerCase(),
    provider: "mock",
    lastActivityAt: 0,
    range: null,
  };
}

function matches(...tabs: SidebarTabMatch[]): SidebarTabMatches {
  const byWorkspace = new Map<string, SidebarTabMatch[]>();
  for (const entry of tabs) {
    byWorkspace.set(entry.workspaceKey, [...(byWorkspace.get(entry.workspaceKey) ?? []), entry]);
  }
  return byWorkspace;
}

const visibleA = new Set(["host:a"]);

describe("pickUniqueSessionIdMatch", () => {
  it("names the one visible chat a pasted id prefix matches", () => {
    const target = tab("host", "a", "9b8394eb-0000-4000-8000-000000000001", "Fix login");
    expect(pickUniqueSessionIdMatch(matches(target), visibleA, "9b8394eb")).toEqual({
      serverId: "host",
      agentId: target.agentId,
      workspaceId: "a",
      title: "Fix login",
    });
  });

  it("ignores chats in workspaces the filter hides, so they cannot add or remove ambiguity", () => {
    const visible = tab("host", "a", "9b8394eb-0000-4000-8000-000000000001", "Visible");
    const hidden = tab("host", "b", "9b8394eb-0000-4000-8000-000000000002", "Hidden");
    expect(pickUniqueSessionIdMatch(matches(visible, hidden), visibleA, "9b8394eb")?.title).toBe(
      "Visible",
    );
    expect(pickUniqueSessionIdMatch(matches(hidden), visibleA, "9b8394eb")).toBeNull();
  });

  it("is null when the prefix names more than one visible chat", () => {
    expect(
      pickUniqueSessionIdMatch(
        matches(
          tab("host", "a", "9b8394eb-0000-4000-8000-000000000001", "One"),
          tab("host", "a", "9b8394eb-0000-4000-8000-000000000002", "Two"),
        ),
        visibleA,
        "9b8394eb",
      ),
    ).toBeNull();
  });

  it("does not treat a title match or a non-id query as an id", () => {
    const titled = tab("host", "a", "11111111-0000-4000-8000-000000000001", "deadbeef notes");
    expect(pickUniqueSessionIdMatch(matches(titled), visibleA, "deadbeef")).toBeNull();
    expect(pickUniqueSessionIdMatch(matches(titled), visibleA, "notes")).toBeNull();
  });
});
