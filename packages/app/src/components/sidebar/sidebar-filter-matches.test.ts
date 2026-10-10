import { describe, expect, it } from "vitest";
import type { SessionTextSearchHit } from "@getpaseo/protocol/messages";
import {
  areSidebarTabMatchesEqual,
  collectSidebarTabTitles,
  findSidebarMatchRange,
  matchSidebarTabTitles,
  mergeSidebarMessageHits,
  selectNestedTabMatches,
  splitSidebarMatch,
  sumSidebarMessageSearchCoverage,
  trimSidebarSnippetLead,
  type SidebarTabSource,
} from "./sidebar-filter-matches";
import { normalizeSidebarQuery } from "./sidebar-filter-sort";

function agent(
  id: string,
  overrides: Partial<SidebarTabSource> & { activity?: string } = {},
): SidebarTabSource {
  return {
    id,
    title: `${id} title`,
    provider: "claude",
    workspaceId: "ws-1",
    parentAgentId: null,
    archivedAt: null,
    labels: {},
    lastActivityAt: new Date(overrides.activity ?? "2026-10-01T00:00:00Z"),
    ...overrides,
  };
}

function hosts(...agents: SidebarTabSource[]) {
  return [{ serverId: "host", agents: new Map(agents.map((item) => [item.id, item])) }];
}

describe("tab title matching", () => {
  it("keeps only tabs a workspace can show: titled, unarchived, root or auto-opened", () => {
    const tabs = collectSidebarTabTitles(
      hosts(
        agent("root", { title: "Relay reconnect" }),
        agent("untitled", { title: null }),
        agent("archived", { archivedAt: new Date("2026-10-02T00:00:00Z") }),
        agent("child", { parentAgentId: "root" }),
        agent("opened-child", {
          parentAgentId: "root",
          labels: { "paseo.auto-open-agent-tab": "true" },
        }),
        agent("moved-child", { parentAgentId: "root", workspaceId: "ws-2" }),
        agent("no-workspace", { workspaceId: undefined }),
      ),
    );
    expect(tabs.map((tab) => [tab.agentId, tab.workspaceKey])).toEqual([
      ["root", "host:ws-1"],
      ["opened-child", "host:ws-1"],
      ["moved-child", "host:ws-2"],
    ]);
  });

  it("groups matches by workspace, newest first, with the matched range", () => {
    const tabs = collectSidebarTabTitles(
      hosts(
        agent("older", { title: "Fix the Relay", activity: "2026-09-01T00:00:00Z" }),
        agent("newer", { title: "Relay retries", activity: "2026-10-05T00:00:00Z" }),
        agent("other", { title: "Unrelated", workspaceId: "ws-2" }),
      ),
    );
    const matches = matchSidebarTabTitles(tabs, normalizeSidebarQuery(" RELAY "));
    expect([...matches.keys()]).toEqual(["host:ws-1"]);
    expect(matches.get("host:ws-1")!.map((match) => [match.agentId, match.range])).toEqual([
      ["newer", { start: 0, length: 5 }],
      ["older", { start: 8, length: 5 }],
    ]);
    expect(matchSidebarTabTitles(tabs, "").size).toBe(0);
  });

  it("treats status-only directory churn as unchanged", () => {
    const query = normalizeSidebarQuery("relay");
    const first = matchSidebarTabTitles(
      collectSidebarTabTitles(hosts(agent("a", { title: "Relay" }))),
      query,
    );
    const second = matchSidebarTabTitles(
      collectSidebarTabTitles(
        hosts(agent("a", { title: "Relay", activity: "2026-10-09T00:00:00Z" })),
      ),
      query,
    );
    const renamed = matchSidebarTabTitles(
      collectSidebarTabTitles(hosts(agent("a", { title: "Relay v2" }))),
      query,
    );
    expect(areSidebarTabMatchesEqual(first, second)).toBe(true);
    expect(areSidebarTabMatchesEqual(first, renamed)).toBe(false);
  });

  it("does not repeat a tab named exactly like its workspace", () => {
    const matches = matchSidebarTabTitles(
      collectSidebarTabTitles(
        hosts(agent("same", { title: "Queue review" }), agent("extra", { title: "Queue fix" })),
      ),
      "queue",
    ).get("host:ws-1");
    expect(
      selectNestedTabMatches(matches, { title: " queue REVIEW", name: "tmpworkspace" }).map(
        (match) => match.agentId,
      ),
    ).toEqual(["extra"]);
    expect(selectNestedTabMatches(undefined, null)).toEqual([]);
  });
});

describe("match emphasis", () => {
  it("finds the range in the displayed text and splits around it", () => {
    expect(findSidebarMatchRange("Sign-In repair", "sign-in")).toEqual({ start: 0, length: 7 });
    expect(findSidebarMatchRange("ＲＥＬＡＹ loop", "relay")).toEqual({ start: 0, length: 5 });
    expect(findSidebarMatchRange("no match here", "relay")).toBeNull();
    expect(splitSidebarMatch("Fix the Relay now", { start: 8, length: 5 })).toEqual({
      before: "Fix the ",
      match: "Relay",
      after: " now",
    });
    expect(splitSidebarMatch("Relay", null)).toEqual({ before: "Relay", match: "", after: "" });
  });

  it("trims snippet lead so the match stays on a single line", () => {
    const snippet = `${"context ".repeat(8)}needle and the rest`;
    const trimmed = trimSidebarSnippetLead({
      snippet,
      matchStart: snippet.indexOf("needle"),
      matchLength: 6,
    });
    expect(trimmed.text.startsWith("…")).toBe(true);
    expect(trimmed.range).not.toBeNull();
    expect(trimmed.text.slice(trimmed.range!.start, trimmed.range!.start + 6)).toBe("needle");
    expect(trimmed.range!.start).toBeLessThanOrEqual(18);
    const short = trimSidebarSnippetLead({ snippet: "a needle", matchStart: 2, matchLength: 6 });
    expect(short).toEqual({ text: "a needle", range: { start: 2, length: 6 } });
  });
});

describe("message hits", () => {
  function hit(agentId: string, timestamp?: string): SessionTextSearchHit {
    return {
      agentId,
      workspaceId: "ws",
      workspaceTitle: "Workspace",
      projectName: "Project",
      title: agentId,
      provider: "codex",
      role: "assistant",
      snippet: "needle",
      matchStart: 0,
      matchLength: 6,
      ...(timestamp ? { timestamp } : {}),
    };
  }

  it("merges hosts newest first and caps the list", () => {
    const merged = mergeSidebarMessageHits(
      new Map([
        ["laptop", [hit("a", "2026-10-01T00:00:00Z"), hit("undated")]],
        ["mini", [hit("b", "2026-10-03T00:00:00Z")]],
      ]),
    );
    expect(merged.map((item) => `${item.serverId}:${item.agentId}`)).toEqual([
      "mini:b",
      "laptop:a",
      "laptop:undated",
    ]);
    expect(new Set(merged.map((item) => item.key)).size).toBe(3);
    expect(
      mergeSidebarMessageHits(new Map([["mini", [hit("a"), hit("b"), hit("c")]]]), 2),
    ).toHaveLength(2);
  });
});

it("sums message-search coverage across hosts and flags any partial host", () => {
  expect(
    sumSidebarMessageSearchCoverage([
      { searchedCount: 180, totalCount: 300, truncated: true },
      { searchedCount: 12, totalCount: 12, truncated: false },
    ]),
  ).toEqual({ searchedCount: 192, totalCount: 312, truncated: true });
  expect(sumSidebarMessageSearchCoverage([])).toEqual({
    searchedCount: 0,
    totalCount: 0,
    truncated: false,
  });
});
