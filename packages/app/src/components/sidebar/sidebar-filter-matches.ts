import type { SessionTextSearchHit } from "@getpaseo/protocol/messages";
import { shouldAutoOpenAgentTab } from "@getpaseo/protocol/agent-labels";
import type { Agent } from "@/stores/session-store";
import { isWorkspaceRootAgent } from "@/subagents/policies";
import { normalizeWorkspaceOpaqueId } from "@/utils/workspace-identity";

/**
 * Pure model for the sidebar filter's two deeper tiers (docs/sidebar-filter.md):
 *
 * - Tab titles, matched on every keystroke against the agent directory the client already holds.
 * - Message text, matched by the daemon (`session.text_search`) and merged here across hosts.
 */

export interface SidebarMatchRange {
  start: number;
  length: number;
}

export type SidebarTabSource = Pick<
  Agent,
  | "id"
  | "title"
  | "provider"
  | "workspaceId"
  | "parentAgentId"
  | "archivedAt"
  | "labels"
  | "lastActivityAt"
>;

export interface SidebarTabTitle {
  serverId: string;
  agentId: string;
  workspaceId: string;
  /** `serverId:workspaceId`, the sidebar's workspace key. */
  workspaceKey: string;
  title: string;
  /** NFKC-lowercased `title`, computed once per directory change rather than per keystroke. */
  normalizedTitle: string;
  provider: string;
  lastActivityAt: number;
}

export interface SidebarTabMatch extends SidebarTabTitle {
  range: SidebarMatchRange | null;
}

export type SidebarTabMatches = ReadonlyMap<string, readonly SidebarTabMatch[]>;

export const EMPTY_SIDEBAR_TAB_MATCHES: SidebarTabMatches = new Map();

export function normalizeSidebarText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase();
}

/**
 * Agent sessions that appear as tabs in their workspace: unarchived, titled, and either a
 * workspace root or explicitly auto-opened. Child agents live inside their parent's tab, so a
 * title match on one would point at a tab that does not exist.
 */
export function collectSidebarTabTitles(
  hosts: ReadonlyArray<{
    serverId: string;
    agents: ReadonlyMap<string, SidebarTabSource> | undefined;
  }>,
): SidebarTabTitle[] {
  const tabs: SidebarTabTitle[] = [];
  for (const { serverId, agents } of hosts) {
    if (!agents) continue;
    for (const agent of agents.values()) {
      if (agent.archivedAt) continue;
      const title = agent.title?.trim();
      const workspaceId = normalizeWorkspaceOpaqueId(agent.workspaceId);
      if (!title || !workspaceId) continue;
      const parent = agent.parentAgentId ? agents.get(agent.parentAgentId) : undefined;
      if (!isWorkspaceRootAgent(agent, parent) && !shouldAutoOpenAgentTab(agent)) continue;
      const activity = agent.lastActivityAt?.getTime();
      tabs.push({
        serverId,
        agentId: agent.id,
        workspaceId,
        workspaceKey: `${serverId}:${workspaceId}`,
        title,
        normalizedTitle: normalizeSidebarText(title),
        provider: agent.provider,
        lastActivityAt: activity !== undefined && Number.isFinite(activity) ? activity : 0,
      });
    }
  }
  return tabs;
}

/** Tab-title matches grouped by workspace key, most recently active first. */
export function matchSidebarTabTitles(
  tabs: readonly SidebarTabTitle[],
  normalizedQuery: string,
): SidebarTabMatches {
  if (!normalizedQuery) return EMPTY_SIDEBAR_TAB_MATCHES;
  const byWorkspace = new Map<string, SidebarTabMatch[]>();
  for (const tab of tabs) {
    if (!tab.normalizedTitle.includes(normalizedQuery)) continue;
    const match: SidebarTabMatch = {
      ...tab,
      range: findSidebarMatchRange(tab.title, normalizedQuery),
    };
    const list = byWorkspace.get(tab.workspaceKey);
    if (list) list.push(match);
    else byWorkspace.set(tab.workspaceKey, [match]);
  }
  for (const list of byWorkspace.values()) {
    list.sort(
      (left, right) =>
        right.lastActivityAt - left.lastActivityAt || left.agentId.localeCompare(right.agentId),
    );
  }
  return byWorkspace;
}

/**
 * Structural equality, so a directory update that changes status but no title keeps the previous
 * map and the filtered tree does not recompute.
 */
export function areSidebarTabMatchesEqual(left: SidebarTabMatches, right: SidebarTabMatches) {
  if (left === right) return true;
  if (left.size !== right.size) return false;
  for (const [key, leftList] of left) {
    const rightList = right.get(key);
    if (!rightList || rightList.length !== leftList.length) return false;
    for (let index = 0; index < leftList.length; index += 1) {
      const a = leftList[index]!;
      const b = rightList[index]!;
      if (
        a.agentId !== b.agentId ||
        a.title !== b.title ||
        a.provider !== b.provider ||
        a.range?.start !== b.range?.start ||
        a.range?.length !== b.range?.length
      ) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Where to emphasize `normalizedQuery` in the displayed `text`. Null when normalization changed
 * the text's length, so an offset into the normalized form would point at the wrong characters;
 * the row still shows, unemphasized.
 */
export function findSidebarMatchRange(
  text: string,
  normalizedQuery: string,
): SidebarMatchRange | null {
  if (!normalizedQuery) return null;
  for (const candidate of [text.toLocaleLowerCase(), normalizeSidebarText(text)]) {
    if (candidate.length !== text.length) continue;
    const start = candidate.indexOf(normalizedQuery);
    if (start !== -1) return { start, length: normalizedQuery.length };
  }
  return null;
}

export interface SidebarTextParts {
  before: string;
  match: string;
  after: string;
}

export function splitSidebarMatch(text: string, range: SidebarMatchRange | null): SidebarTextParts {
  if (!range || range.length === 0 || range.start >= text.length) {
    return { before: text, match: "", after: "" };
  }
  const end = Math.min(text.length, range.start + range.length);
  return {
    before: text.slice(0, range.start),
    match: text.slice(range.start, end),
    after: text.slice(end),
  };
}

/**
 * The tab rows shown under a workspace row. A tab named exactly like the workspace adds no
 * evidence beyond the workspace row itself, so it is left out rather than shown twice.
 */
export function selectNestedTabMatches(
  matches: readonly SidebarTabMatch[] | undefined,
  workspace: { title: string | null; name: string } | null,
): readonly SidebarTabMatch[] {
  if (!matches || matches.length === 0) return [];
  const names = new Set(
    [workspace?.title, workspace?.name].flatMap((value) =>
      value ? [normalizeSidebarText(value.trim())] : [],
    ),
  );
  return matches.filter((match) => !names.has(match.normalizedTitle));
}

export interface SidebarMessageHit extends SessionTextSearchHit {
  serverId: string;
  key: string;
}

function hitTime(hit: SessionTextSearchHit): number {
  const time = hit.timestamp ? Date.parse(hit.timestamp) : NaN;
  return Number.isFinite(time) ? time : 0;
}

/** Hits from every host in one list, newest first. */
export function mergeSidebarMessageHits(
  byServer: ReadonlyMap<string, readonly SessionTextSearchHit[]>,
  limit = 50,
): SidebarMessageHit[] {
  const merged: SidebarMessageHit[] = [];
  for (const [serverId, hits] of byServer) {
    hits.forEach((hit, index) => {
      merged.push({
        ...hit,
        serverId,
        key: JSON.stringify([serverId, hit.agentId, hit.seq ?? hit.timestamp ?? index]),
      });
    });
  }
  return merged.sort((left, right) => hitTime(right) - hitTime(left)).slice(0, limit);
}

/**
 * The daemon centers its snippet on the match, but a sidebar row shows one short line. Keep a
 * little context before the match so the emphasized text is what the line actually shows.
 */
export function trimSidebarSnippetLead(
  hit: Pick<SessionTextSearchHit, "snippet" | "matchStart" | "matchLength">,
  leadLength = 16,
): { text: string; range: SidebarMatchRange | null } {
  const range =
    hit.matchLength > 0 && hit.matchStart + hit.matchLength <= hit.snippet.length
      ? { start: hit.matchStart, length: hit.matchLength }
      : null;
  if (!range || range.start <= leadLength + 1) return { text: hit.snippet, range };
  let cut = range.start - leadLength;
  const space = hit.snippet.indexOf(" ", cut);
  if (space !== -1 && space < range.start) cut = space + 1;
  return {
    text: `…${hit.snippet.slice(cut)}`,
    range: { start: range.start - cut + 1, length: range.length },
  };
}
