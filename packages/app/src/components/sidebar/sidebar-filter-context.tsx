import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { SessionTextSearchHit } from "@getpaseo/protocol/messages";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useHostFeatureMap } from "@/runtime/host-features";
import {
  EMPTY_SIDEBAR_TAB_MATCHES,
  mergeSidebarMessageHits,
  type SidebarMessageHit,
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
}

const IDLE_MESSAGE_SEARCH: SidebarMessageSearchState = { query: "", status: "idle", hits: [] };

const SidebarMessageSearchContext = createContext<SidebarMessageSearchState>(IDLE_MESSAGE_SEARCH);

export const SIDEBAR_MESSAGE_SEARCH_MIN_QUERY = 3;
export const SIDEBAR_MESSAGE_SEARCH_DEBOUNCE_MS = 300;

async function searchHost(input: {
  serverId: string;
  query: string;
  workspaceIds: readonly string[];
}): Promise<readonly SessionTextSearchHit[]> {
  const client = getHostRuntimeStore().getClient(input.serverId);
  if (!client || input.workspaceIds.length === 0) return [];
  try {
    const payload = await client.searchSessionText({
      query: input.query,
      workspaceIds: [...input.workspaceIds],
    });
    return payload.hits;
  } catch {
    // Disconnected, superseded, or failed: the tier is best-effort and never shows an error.
    return [];
  }
}

/**
 * Debounced, capability-gated message search across every host in scope. A newer query cancels
 * this hook's interest in older responses; the daemon separately aborts the older scan.
 */
export function useSidebarMessageSearch(
  rawQuery: string,
  normalizedQuery: string,
  scope: SidebarMessageSearchScope,
): SidebarMessageSearchState {
  const serverIds = useMemo(() => [...scope.workspaceIdsByServer.keys()], [scope]);
  const support = useHostFeatureMap(serverIds, "sessionTextSearch");
  const capableServerIds = useMemo(
    () => serverIds.filter((serverId) => support.get(serverId) === true),
    [serverIds, support],
  );
  const query = rawQuery.trim();
  const enabled =
    normalizedQuery.length >= SIDEBAR_MESSAGE_SEARCH_MIN_QUERY && capableServerIds.length > 0;
  const [result, setResult] = useState<{
    status: Exclude<SidebarMessageSearchStatus, "idle">;
    hits: readonly SidebarMessageHit[];
  } | null>(null);

  useEffect(() => {
    if (!enabled) {
      setResult(null);
      return undefined;
    }
    let cancelled = false;
    // Earlier hits stay visible while the next search runs; the group below the tree changes in
    // place instead of collapsing and reappearing on each keystroke.
    setResult((previous) => ({ status: "searching", hits: previous?.hits ?? [] }));
    const timer = setTimeout(() => {
      const hitsByServer = new Map<string, readonly SessionTextSearchHit[]>();
      for (const serverId of capableServerIds) {
        const workspaceIds = scope.workspaceIdsByServer.get(serverId) ?? [];
        void searchHost({ serverId, query, workspaceIds }).then((hits) => {
          if (cancelled) return null;
          hitsByServer.set(serverId, hits);
          setResult({
            status: hitsByServer.size === capableServerIds.length ? "done" : "searching",
            hits: mergeSidebarMessageHits(hitsByServer),
          });
          return null;
        });
      }
    }, SIDEBAR_MESSAGE_SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [capableServerIds, enabled, query, scope]);

  return useMemo(() => {
    if (!enabled || !result) return { ...IDLE_MESSAGE_SEARCH, query: normalizedQuery };
    return { query: normalizedQuery, status: result.status, hits: result.hits };
  }, [enabled, normalizedQuery, result]);
}

export function SidebarMessageSearchProvider({
  rawQuery,
  normalizedQuery,
  scope,
  children,
}: {
  rawQuery: string;
  normalizedQuery: string;
  scope: SidebarMessageSearchScope;
  children: ReactNode;
}) {
  const value = useSidebarMessageSearch(rawQuery, normalizedQuery, scope);
  return (
    <SidebarMessageSearchContext.Provider value={value}>
      {children}
    </SidebarMessageSearchContext.Provider>
  );
}

export function useSidebarMessageSearchState(): SidebarMessageSearchState {
  return useContext(SidebarMessageSearchContext);
}
