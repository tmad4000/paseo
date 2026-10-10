import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { SessionTextSearchHit } from "@getpaseo/protocol/messages";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useHostFeatureMap } from "@/runtime/host-features";
import {
  EMPTY_SIDEBAR_TAB_MATCHES,
  mergeSidebarMessageHits,
  sumSidebarMessageSearchCoverage,
  type SidebarMessageHit,
  type SidebarMessageSearchCoverage,
  type SidebarTabMatch,
  type SidebarTabMatches,
} from "./sidebar-filter-matches";

/**
 * The sidebar filter's deeper tiers live in their own contexts rather than on the sidebar model:
 * tab matches change on every keystroke and message hits arrive asynchronously, and neither
 * should re-render the whole model consumer tree when they do. See docs/sidebar-filter.md.
 */

interface SidebarTabMatchesValue {
  tabMatches: SidebarTabMatches;
}

const SidebarTabMatchesContext = createContext<SidebarTabMatchesValue>({
  tabMatches: EMPTY_SIDEBAR_TAB_MATCHES,
});

const NO_TAB_MATCHES: readonly SidebarTabMatch[] = [];

export function SidebarTabMatchesProvider({
  tabMatches,
  children,
}: {
  tabMatches: SidebarTabMatches;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ tabMatches }), [tabMatches]);
  return (
    <SidebarTabMatchesContext.Provider value={value}>{children}</SidebarTabMatchesContext.Provider>
  );
}

export function useSidebarWorkspaceTabMatches(workspaceKey: string): readonly SidebarTabMatch[] {
  return useContext(SidebarTabMatchesContext).tabMatches.get(workspaceKey) ?? NO_TAB_MATCHES;
}

/** The workspaces each host may answer for: the sidebar's current scope before the text query. */
export interface SidebarMessageSearchScope {
  key: string;
  workspaceIdsByServer: ReadonlyMap<string, readonly string[]>;
}

export const EMPTY_SIDEBAR_MESSAGE_SEARCH_SCOPE: SidebarMessageSearchScope = {
  key: "",
  workspaceIdsByServer: new Map(),
};

export function buildSidebarMessageSearchScope(
  workspaces: Iterable<{ serverId: string; workspaceId: string }>,
): SidebarMessageSearchScope {
  const byServer = new Map<string, string[]>();
  for (const { serverId, workspaceId } of workspaces) {
    const ids = byServer.get(serverId);
    if (ids) ids.push(workspaceId);
    else byServer.set(serverId, [workspaceId]);
  }
  for (const ids of byServer.values()) ids.sort();
  const key = JSON.stringify([...byServer].sort(([left], [right]) => left.localeCompare(right)));
  return { key, workspaceIdsByServer: byServer };
}

export type SidebarMessageSearchStatus = "idle" | "searching" | "done";

export interface SidebarMessageSearchState {
  /** Normalized query the filter is showing, so rows can tell an active filter from none. */
  query: string;
  status: SidebarMessageSearchStatus;
  hits: readonly SidebarMessageHit[];
  /** Summed over the hosts that answered; null until one has. */
  coverage: SidebarMessageSearchCoverage | null;
}

const IDLE_MESSAGE_SEARCH: SidebarMessageSearchState = {
  query: "",
  status: "idle",
  hits: [],
  coverage: null,
};

const SidebarMessageSearchContext = createContext<SidebarMessageSearchState>(IDLE_MESSAGE_SEARCH);

export const SIDEBAR_MESSAGE_SEARCH_MIN_QUERY = 3;
export const SIDEBAR_MESSAGE_SEARCH_DEBOUNCE_MS = 300;

interface HostSearchResult extends SidebarMessageSearchCoverage {
  hits: readonly SessionTextSearchHit[];
}

const EMPTY_HOST_RESULT: HostSearchResult = {
  hits: [],
  searchedCount: 0,
  totalCount: 0,
  truncated: false,
};

async function searchHost(input: {
  serverId: string;
  query: string;
  workspaceIds: readonly string[];
}): Promise<HostSearchResult> {
  const client = getHostRuntimeStore().getClient(input.serverId);
  if (!client || input.workspaceIds.length === 0) return EMPTY_HOST_RESULT;
  try {
    const payload = await client.searchSessionText({
      query: input.query,
      workspaceIds: [...input.workspaceIds],
    });
    return payload;
  } catch {
    // Disconnected, superseded, or failed: the tier is best-effort and never shows an error.
    return EMPTY_HOST_RESULT;
  }
}

function hitsByServer(
  byServer: ReadonlyMap<string, HostSearchResult>,
): Map<string, readonly SessionTextSearchHit[]> {
  return new Map([...byServer].map(([serverId, answer]) => [serverId, answer.hits]));
}

/**
 * Debounced, capability-gated message search across every host in scope. A newer query cancels
 * this hook's interest in older responses; the daemon separately aborts the older scan.
 *
 * Status is derived during render, not set by the effect: whenever tier 2 is eligible and the
 * latest answer is for a different query or scope, the state reads "searching" in the same render
 * that changed the query. Setting it from the effect left one frame of "idle", which flashed the
 * empty state on an empty tree.
 */
export function useSidebarMessageSearch(
  rawQuery: string,
  normalizedQuery: string,
  scope: SidebarMessageSearchScope,
  messagesEnabled = true,
): SidebarMessageSearchState {
  const serverIds = useMemo(() => [...scope.workspaceIdsByServer.keys()], [scope]);
  const support = useHostFeatureMap(serverIds, "sessionTextSearch");
  const capableServerIds = useMemo(
    () => serverIds.filter((serverId) => support.get(serverId) === true),
    [serverIds, support],
  );
  const query = rawQuery.trim();
  const enabled =
    messagesEnabled &&
    normalizedQuery.length >= SIDEBAR_MESSAGE_SEARCH_MIN_QUERY &&
    capableServerIds.length > 0;
  const requestKey = `${query}\n${scope.key}\n${capableServerIds.join(",")}`;
  const [result, setResult] = useState<{
    key: string;
    complete: boolean;
    hits: readonly SidebarMessageHit[];
    coverage: SidebarMessageSearchCoverage;
  } | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      const byServer = new Map<string, HostSearchResult>();
      for (const serverId of capableServerIds) {
        const workspaceIds = scope.workspaceIdsByServer.get(serverId) ?? [];
        void searchHost({ serverId, query, workspaceIds }).then((answer) => {
          if (cancelled) return null;
          byServer.set(serverId, answer);
          setResult({
            key: requestKey,
            complete: byServer.size === capableServerIds.length,
            hits: mergeSidebarMessageHits(hitsByServer(byServer)),
            coverage: sumSidebarMessageSearchCoverage(byServer.values()),
          });
          return null;
        });
      }
    }, SIDEBAR_MESSAGE_SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [capableServerIds, enabled, query, requestKey, scope]);

  return useMemo((): SidebarMessageSearchState => {
    if (!enabled) return { ...IDLE_MESSAGE_SEARCH, query: normalizedQuery };
    // Earlier hits stay visible while the next search runs, so the group below the tree changes in
    // place instead of collapsing and reappearing on each keystroke.
    const current = result !== null && result.key === requestKey ? result : null;
    return {
      query: normalizedQuery,
      status: current?.complete ? "done" : "searching",
      hits: result?.hits ?? [],
      coverage: current?.coverage ?? null,
    };
  }, [enabled, normalizedQuery, requestKey, result]);
}

export function SidebarMessageSearchProvider({
  rawQuery,
  normalizedQuery,
  scope,
  messagesEnabled,
  children,
}: {
  rawQuery: string;
  normalizedQuery: string;
  scope: SidebarMessageSearchScope;
  /** False when the filter scope is Names only. */
  messagesEnabled: boolean;
  children: ReactNode;
}) {
  const value = useSidebarMessageSearch(rawQuery, normalizedQuery, scope, messagesEnabled);
  return (
    <SidebarMessageSearchContext.Provider value={value}>
      {children}
    </SidebarMessageSearchContext.Provider>
  );
}

export function useSidebarMessageSearchState(): SidebarMessageSearchState {
  return useContext(SidebarMessageSearchContext);
}
