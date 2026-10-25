import { describe, expect, it } from "vitest";
import {
  buildRecentSessionRows,
  orderRowsByRecentSessions,
  type RecentSessionAgentInfo,
} from "./recent-sessions";
import type { RecentSession } from "./recent-workspaces";

function session(agentId: string, visitedAt = 1): RecentSession {
  return { serverId: "s", workspaceId: `ws-${agentId}`, agentId, visitedAt };
}

function info(overrides: Partial<RecentSessionAgentInfo> = {}): RecentSessionAgentInfo {
  return {
    title: "Title",
    provider: "claude",
    status: "idle",
    requiresAttention: false,
    attentionReason: null,
    pendingPermissionCount: 0,
    archived: false,
    ...overrides,
  };
}

describe("recent session rows", () => {
  it("lists openable sessions most recent first without the one on screen", () => {
    const rows = buildRecentSessionRows({
      sessions: [
        session("current"),
        session("a"),
        session("gone"),
        session("archived"),
        session("b"),
      ],
      current: { serverId: "s", agentId: "current" },
      agentInfo: (_serverId, agentId) => {
        if (agentId === "gone") return null;
        return info({ title: agentId, archived: agentId === "archived" });
      },
      breadcrumb: (_serverId, workspaceId) => `Project · ${workspaceId}`,
    });

    expect(rows.map((row) => [row.agentId, row.title, row.breadcrumb])).toEqual([
      ["a", "a", "Project · ws-a"],
      ["b", "b", "Project · ws-b"],
    ]);
  });

  it("stops at the limit", () => {
    const rows = buildRecentSessionRows({
      sessions: ["a", "b", "c"].map((id) => session(id)),
      current: null,
      agentInfo: () => info(),
      breadcrumb: () => "",
      limit: 2,
    });
    expect(rows.map((row) => row.agentId)).toEqual(["a", "b"]);
  });

  it("carries live status for the menu's indicator", () => {
    const [row] = buildRecentSessionRows({
      sessions: [session("a")],
      current: null,
      agentInfo: () =>
        info({ status: "running", requiresAttention: true, attentionReason: "permission" }),
      breadcrumb: () => "",
    });
    expect(row).toMatchObject({
      status: "running",
      requiresAttention: true,
      attentionReason: "permission",
    });
  });

  it("orders existing result rows by session recency, dropping unvisited and current", () => {
    const rows = [{ id: "x" }, { id: "b" }, { id: "current" }, { id: "a" }];
    const ordered = orderRowsByRecentSessions({
      rows,
      sessionKeyOf: (row) => `s:${row.id}`,
      sessions: [session("current"), session("a"), session("b")],
      currentKey: "s:current",
    });
    expect(ordered.map((row) => row.id)).toEqual(["a", "b"]);
  });
});
