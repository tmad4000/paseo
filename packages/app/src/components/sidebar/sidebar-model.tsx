import { useShallow } from "zustand/react/shallow";
import { shallow } from "zustand/shallow";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { olderMessageSortHosts } from "./message-sort-capability";
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  useSidebarWorkspacesList,
  type SidebarProjectEntry,
  type SidebarWorkspaceEntry,
  type SidebarWorkspacesListResult,
} from "@/hooks/use-sidebar-workspaces-list";
import { useSidebarWorkspaceEntries } from "@/hooks/use-sidebar-workspace-entries";
import { usePinnedSidebarKeys, type PinnedSidebarGroups } from "@/hooks/use-sidebar-pins";
import { useSidebarCollapsedSectionsStore } from "@/stores/sidebar-collapsed-sections-store";
import {
  hasActiveSidebarLabelFilter,
  useSidebarViewStore,
  type SidebarGroupMode,
} from "@/stores/sidebar-view-store";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";
import type { SidebarShortcutModel } from "@/utils/sidebar-shortcuts";
import { buildSidebarProjection } from "./sidebar-projection";
import type { SidebarProjectIconTarget } from "@/utils/sidebar-project-row-model";
import { filterWorkspacesByLabels, type SidebarWorkspaceGroup } from "./sidebar-labels";
import { filterWorkspacesByProjects, resolveActiveProjectFilters } from "./sidebar-project-filter";
import { filterWorkspacesByMine } from "./sidebar-mine-filter";
import {
  filterAndSortSidebarProjects,
  normalizeSidebarQuery,
  sortSidebarWorkspaces,
  workspaceMatchesSidebarFilter,
  type SidebarSortMode,
} from "./sidebar-filter-sort";
import {
  areSidebarTabMatchesEqual,
  collectSidebarTabTitles,
  EMPTY_SIDEBAR_TAB_MATCHES,
  matchSidebarTabTitles,
  type SidebarTabMatches,
} from "./sidebar-filter-matches";
import {
  buildSidebarMessageSearchScope,
  EMPTY_SIDEBAR_MESSAGE_SEARCH_SCOPE,
  SidebarMessageSearchProvider,
  SidebarTabMatchesProvider,
  type SidebarMessageSearchScope,
} from "./sidebar-filter-context";
import { useSidebarFilterRequestStore } from "./sidebar-filter-request";
import { buildSidebarSessionRows, type SidebarSessionRow } from "./sidebar-sessions";
import { buildSidebarTabRows, type SidebarTabRow } from "./sidebar-tabs";
import { useWorkspaceLayoutStore, type WorkspaceLayout } from "@/stores/workspace-layout-store";
import { pickUniqueSessionIdMatch, type SessionTarget } from "./find-or-start";
import {
  hasAuthoritativeWorkspaceLabelCatalog,
  useWorkspaceLabelProjection,
} from "@/workspace-labels";
import { orderProjectsWithPins } from "@/default-project/model";
import { useProjectPinStates } from "@/default-project/hooks";
import { usePinnedProjectOrderStore } from "@/default-project/pinned-project-order-store";

interface SidebarModel extends SidebarWorkspacesListResult {
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  /**
   * Every project the sidebar could show, before any filter narrows it.
   *
   * `projects` is the FILTERED list. A surface that offers a filter picker must read this one, or
   * narrowing the filter deletes the rows that would undo it.
   */
  allProjects: SidebarProjectEntry[];
  /** The project filter as it is actually being applied — see `resolveActiveProjectFilters`. */
  resolvedProjectFilters: readonly string[];
  hasProjectsBeforeFilter: boolean;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  sortMode: SidebarSortMode;
  /** Hosts whose chats sort by legacy clocks, labelled with their version. */
  olderMessageSortHosts: readonly string[];
  setSortMode: (mode: SidebarSortMode) => void;
  groupMode: SidebarGroupMode;
  /** The Mine filter is on: delegated and scheduled workspaces are hidden. */
  mineOnly: boolean;
  /** Workspaces the Mine filter is hiding right now, within the project and label filters. */
  mineHiddenCount: number;
  workspaceGroups: SidebarWorkspaceGroup[];
  /** Sessions mode's rows: every visible top-level chat in the chosen sort. Empty in other modes. */
  sessionRows: readonly SidebarSessionRow[];
  /** Tabs mode's rows: every open tab in the visible workspaces. Empty in other modes. */
  tabRows: readonly SidebarTabRow[];
  projectIconTargets: SidebarProjectIconTarget[];
  pinnedGroups: PinnedSidebarGroups;
  /** View keys of pinned and Default projects, which lead `projects` in every sort mode. */
  pinnedProjectViewKeys: ReadonlySet<string>;
  collapsedProjectKeys: ReadonlySet<string>;
  toggleProjectCollapsed: (projectViewKey: string) => void;
  shortcutModel: SidebarShortcutModel;
}

const SidebarModelContext = createContext<SidebarModel | null>(null);

const NO_AGENT_MAPS: ReadonlyArray<ReadonlyMap<string, Agent> | undefined> = [];
const NO_SESSION_ROWS: readonly SidebarSessionRow[] = [];
const NO_TAB_ROWS: readonly SidebarTabRow[] = [];
const NO_LAYOUTS: Readonly<Record<string, WorkspaceLayout | undefined>> = {};

/**
 * Tabs mode's rows. Reads the layouts and agent directories only while that mode is on, so the
 * other modes pay nothing for it.
 */
function useSidebarTabRows(input: {
  enabled: boolean;
  serverIds: readonly string[];
  workspaces: readonly SidebarWorkspaceEntry[];
}): readonly SidebarTabRow[] {
  const { enabled, serverIds, workspaces } = input;
  const layoutByWorkspace = useWorkspaceLayoutStore((state) =>
    enabled ? state.layoutByWorkspace : NO_LAYOUTS,
  );
  const agentMaps = useStoreWithEqualityFn(
    useSessionStore,
    (state) =>
      enabled ? serverIds.map((serverId) => state.sessions[serverId]?.agents) : NO_AGENT_MAPS,
    shallow,
  );
  return useMemo(() => {
    if (!enabled) return NO_TAB_ROWS;
    return buildSidebarTabRows({
      hosts: serverIds.map((serverId, index) => ({ serverId, agents: agentMaps[index] })),
      workspaces,
      layoutByWorkspace,
    });
  }, [agentMaps, enabled, layoutByWorkspace, serverIds, workspaces]);
}

/**
 * Sessions mode's rows. Reads the agent directories only while that mode is on, so the other
 * modes pay nothing for it.
 */
function useSidebarSessionRows(input: {
  enabled: boolean;
  serverIds: readonly string[];
  workspaces: readonly SidebarWorkspaceEntry[];
  normalizedQuery: string;
  sortMode: SidebarSortMode;
}): readonly SidebarSessionRow[] {
  const { enabled, serverIds, workspaces, normalizedQuery, sortMode } = input;
  const agentMaps = useStoreWithEqualityFn(
    useSessionStore,
    (state) =>
      enabled ? serverIds.map((serverId) => state.sessions[serverId]?.agents) : NO_AGENT_MAPS,
    shallow,
  );
  return useMemo(() => {
    if (!enabled) return NO_SESSION_ROWS;
    return buildSidebarSessionRows({
      hosts: serverIds.map((serverId, index) => ({ serverId, agents: agentMaps[index] })),
      workspaces,
      query: normalizedQuery,
      sortMode,
    });
  }, [agentMaps, enabled, normalizedQuery, serverIds, sortMode, workspaces]);
}

/**
 * Tab-title matches for the live filter. The agent directory is only read while a query is
 * active, and the result keeps its previous identity when only statuses changed, so a running
 * agent does not recompute the filtered tree on every update.
 */
function useSidebarTabMatches(
  serverIds: readonly string[],
  normalizedQuery: string,
): SidebarTabMatches {
  const agentMaps = useStoreWithEqualityFn(
    useSessionStore,
    (state) =>
      normalizedQuery
        ? serverIds.map((serverId) => state.sessions[serverId]?.agents)
        : NO_AGENT_MAPS,
    shallow,
  );
  const tabTitles = useMemo(
    () =>
      collectSidebarTabTitles(
        serverIds.map((serverId, index) => ({ serverId, agents: agentMaps[index] })),
      ),
    [agentMaps, serverIds],
  );
  const previousRef = useRef<SidebarTabMatches>(EMPTY_SIDEBAR_TAB_MATCHES);
  return useMemo(() => {
    const next = matchSidebarTabTitles(tabTitles, normalizedQuery);
    if (areSidebarTabMatchesEqual(previousRef.current, next)) return previousRef.current;
    previousRef.current = next;
    return next;
  }, [normalizedQuery, tabTitles]);
}

/** A pasted session id's one visible chat; keeps its identity while it names the same chat. */
function useUniqueSessionIdMatch(
  tabMatches: SidebarTabMatches,
  visibleWorkspaceKeys: ReadonlySet<string>,
  normalizedQuery: string,
): SessionTarget | null {
  const previousRef = useRef<SessionTarget | null>(null);
  return useMemo(() => {
    const next = pickUniqueSessionIdMatch(tabMatches, visibleWorkspaceKeys, normalizedQuery);
    const previous = previousRef.current;
    if (
      next &&
      previous &&
      next.serverId === previous.serverId &&
      next.agentId === previous.agentId &&
      next.workspaceId === previous.workspaceId &&
      next.title === previous.title
    )
      return previous;
    previousRef.current = next;
    return next;
  }, [normalizedQuery, tabMatches, visibleWorkspaceKeys]);
}

export function SidebarModelProvider({
  active,
  children,
}: {
  active?: boolean;
  children: ReactNode;
}) {
  const list = useSidebarWorkspacesList({ enabled: active });
  const groupMode = useSidebarViewStore((state) => state.groupMode);
  const labelFilter = useSidebarViewStore((state) => state.labelFilter);
  const projectFilters = useSidebarViewStore((state) => state.projectFilters);
  const mineOnly = useSidebarViewStore((state) => state.mineOnly);
  const [searchQuery, setSearchQuery] = useState("");
  const filterScope = useSidebarViewStore((state) => state.filterScope);
  // "Search messages for …" from the command center lands here; the find field mirrors it.
  const filterRequest = useSidebarFilterRequestStore((state) => state.request);
  useEffect(() => {
    if (filterRequest) setSearchQuery(filterRequest.query);
  }, [filterRequest]);
  const sortMode = useSidebarViewStore((state) => state.sortMode);
  const setSortMode = useSidebarViewStore((state) => state.setSortMode);
  const olderSortHosts = useSessionStore(
    useShallow((state) => olderMessageSortHosts(state, list.serverIds)),
  );
  const normalizedQuery = useMemo(() => normalizeSidebarQuery(searchQuery), [searchQuery]);
  const reconcileLabelFilter = useSidebarViewStore((state) => state.reconcileLabelFilter);
  const { hosts: labelHosts } = useWorkspaceLabelProjection();
  const collapsedProjectKeys = useSidebarCollapsedSectionsStore(
    (state) => state.collapsedProjectKeys,
  );
  const collapsedWorkspaceGroupKeys = useSidebarCollapsedSectionsStore(
    (state) => state.collapsedWorkspaceGroupKeys,
  );
  const pinnedCollapsed = useSidebarCollapsedSectionsStore((state) => state.collapsedPinned);
  const pinnedWorkspaceOrder = useSidebarOrderStore((state) => state.pinnedWorkspaceOrder);
  const toggleProjectCollapsed = useSidebarCollapsedSectionsStore(
    (state) => state.toggleProjectCollapsed,
  );
  const availableLabelNames = useMemo(
    () => labelHosts.flatMap((host) => host.labels.map((label) => label.name)),
    [labelHosts],
  );
  const hasAuthoritativeLabelCatalog = hasAuthoritativeWorkspaceLabelCatalog(labelHosts);
  useEffect(() => {
    if (!hasAuthoritativeLabelCatalog) return;
    reconcileLabelFilter(availableLabelNames);
  }, [availableLabelNames, hasAuthoritativeLabelCatalog, reconcileLabelFilter]);
  const hasActiveLabelFilter = hasActiveSidebarLabelFilter(labelFilter);
  const resolvedProjectFilters = useMemo(
    () =>
      resolveActiveProjectFilters(
        projectFilters,
        new Set(list.projects.map((project) => project.viewKey)),
      ),
    [projectFilters, list.projects],
  );
  const hasActiveProjectFilter = resolvedProjectFilters.length > 0;
  // The project filter is deliberately absent from this gate. It reads `projectViewKey`, which
  // lives on the project and the placement, so it can narrow the project list without hydrating
  // anything; the label filter reads `labels`, which only exists on an entry. Hydration opens a
  // live session-store subscription over every workspace on every visible host, so widening this
  // for a filter that does not need it costs a retained-but-inactive sidebar real work.
  const needsWorkspaceEntries =
    groupMode !== "project" ||
    hasActiveLabelFilter ||
    mineOnly ||
    Boolean(normalizedQuery) ||
    sortMode !== "manual";
  const workspaceEntriesByKey = useSidebarWorkspaceEntries(
    list.workspacePlacements,
    active !== false || needsWorkspaceEntries,
  );
  const tabMatches = useSidebarTabMatches(list.serverIds, normalizedQuery);
  const tabMatchedWorkspaceKeys = useMemo(() => new Set(tabMatches.keys()), [tabMatches]);
  // Project, label and Mine filters, before the text query: what the query's tiers may search.
  const { workspaces: scopedWorkspaces, hiddenCount: mineHiddenCount } = useMemo(() => {
    const byProject = filterWorkspacesByProjects({
      workspaces: [...workspaceEntriesByKey.values()],
      projectFilters: resolvedProjectFilters,
    });
    const byLabel = filterWorkspacesByLabels({ workspaces: byProject, ...labelFilter });
    return filterWorkspacesByMine({ workspaces: byLabel, mineOnly });
  }, [labelFilter, mineOnly, resolvedProjectFilters, workspaceEntriesByKey]);
  const filteredWorkspaceEntriesByKey = useMemo(() => {
    const filtered = scopedWorkspaces.filter((workspace) =>
      workspaceMatchesSidebarFilter(workspace, normalizedQuery, tabMatchedWorkspaceKeys),
    );
    const sorted = sortSidebarWorkspaces(filtered, workspaceEntriesByKey, sortMode);
    return new Map(sorted.map((workspace) => [workspace.workspaceKey, workspace]));
  }, [normalizedQuery, sortMode, scopedWorkspaces, tabMatchedWorkspaceKeys, workspaceEntriesByKey]);
  const messageSearchScopeRef = useRef<SidebarMessageSearchScope>(
    EMPTY_SIDEBAR_MESSAGE_SEARCH_SCOPE,
  );
  // Entries change identity on every status update; the scope only changes when its membership
  // does, so the debounced message search is not restarted by unrelated activity.
  const messageSearchScope = useMemo(() => {
    if (!normalizedQuery) return messageSearchScopeRef.current;
    const next = buildSidebarMessageSearchScope(scopedWorkspaces);
    if (next.key === messageSearchScopeRef.current.key) return messageSearchScopeRef.current;
    messageSearchScopeRef.current = next;
    return next;
  }, [normalizedQuery, scopedWorkspaces]);
  // Sessions mode filters chats by their own titles, so it starts from the scoped workspaces
  // rather than the ones the text query kept. Manual order follows the arranged projects.
  const sessionWorkspaces = useMemo(() => {
    if (groupMode !== "sessions") return scopedWorkspaces;
    if (sortMode !== "manual") return scopedWorkspaces;
    const byKey = new Map(scopedWorkspaces.map((workspace) => [workspace.workspaceKey, workspace]));
    return list.projects.flatMap((project) =>
      project.workspaces.flatMap((workspace) => {
        const entry = byKey.get(workspace.workspaceKey);
        return entry ? [entry] : [];
      }),
    );
  }, [groupMode, list.projects, scopedWorkspaces, sortMode]);
  // Tabs mode cannot match tab titles outside the panels' own descriptor hooks, so it keeps the
  // workspaces the text query kept (names and tab titles) and lists all of their tabs.
  const tabWorkspaces = useMemo(() => {
    if (groupMode !== "tabs") return scopedWorkspaces;
    const filtered = [...filteredWorkspaceEntriesByKey.values()];
    if (sortMode !== "manual") return filtered;
    return list.projects.flatMap((project) =>
      project.workspaces.flatMap((workspace) => {
        const entry = filteredWorkspaceEntriesByKey.get(workspace.workspaceKey);
        return entry ? [entry] : [];
      }),
    );
  }, [filteredWorkspaceEntriesByKey, groupMode, list.projects, scopedWorkspaces, sortMode]);
  const tabRows = useSidebarTabRows({
    enabled: groupMode === "tabs",
    serverIds: list.serverIds,
    workspaces: tabWorkspaces,
  });
  const sessionRows = useSidebarSessionRows({
    enabled: groupMode === "sessions",
    serverIds: list.serverIds,
    workspaces: sessionWorkspaces,
    normalizedQuery,
    sortMode,
  });
  const visibleWorkspaceKeys = useMemo(
    () => new Set(filteredWorkspaceEntriesByKey.keys()),
    [filteredWorkspaceEntriesByKey],
  );
  const uniqueSession = useUniqueSessionIdMatch(tabMatches, visibleWorkspaceKeys, normalizedQuery);
  // The filters prune differently on purpose. The project filter is a membership test on the
  // project itself, so a project you filtered TO survives even with no workspaces — it still owns
  // a header row you can create your first workspace under. The label and Mine filters can only
  // ask about workspaces, so a project they empty has nothing left to show.
  const filteredProjects = useMemo(() => {
    let projects = list.projects;
    if (hasActiveProjectFilter) {
      const included = new Set(resolvedProjectFilters);
      projects = projects.filter((project) => included.has(project.viewKey));
    }
    const workspaceFilterActive = hasActiveLabelFilter || mineOnly;
    if (workspaceFilterActive || normalizedQuery) {
      projects = projects.flatMap((project) => {
        const workspaces = project.workspaces.filter((workspace) =>
          visibleWorkspaceKeys.has(workspace.workspaceKey),
        );
        const projectNameMatches = project.projectName
          .normalize("NFKC")
          .toLocaleLowerCase()
          .includes(normalizedQuery);
        return workspaces.length > 0 ||
          (!workspaceFilterActive && normalizedQuery && projectNameMatches)
          ? [{ ...project, workspaces }]
          : [];
      });
    }
    return filterAndSortSidebarProjects({
      projects,
      entries: filteredWorkspaceEntriesByKey,
      query: normalizedQuery,
      mode: sortMode,
      tabMatchedWorkspaceKeys,
    });
  }, [
    hasActiveLabelFilter,
    hasActiveProjectFilter,
    mineOnly,
    normalizedQuery,
    sortMode,
    filteredWorkspaceEntriesByKey,
    resolvedProjectFilters,
    list.projects,
    tabMatchedWorkspaceKeys,
    visibleWorkspaceKeys,
  ]);
  const projectPinStates = useProjectPinStates(list.projects);
  const pinnedProjectOrder = usePinnedProjectOrderStore((state) => state.pinnedProjectOrder);
  const pinOrdered = useMemo(
    () =>
      orderProjectsWithPins({
        projects: filteredProjects,
        pinStates: projectPinStates,
        pinnedProjectOrder,
      }),
    [filteredProjects, pinnedProjectOrder, projectPinStates],
  );
  const orderedProjects = pinOrdered.projects;
  const pinnedKeys = usePinnedSidebarKeys(orderedProjects);
  const projectionInput = useMemo(
    () => ({
      projects: orderedProjects,
      pinnedKeys,
      pinnedWorkspaceOrder,
      workspaceEntriesByKey: filteredWorkspaceEntriesByKey,
      projectNamesByViewKey: list.projectNamesByViewKey,
      groupMode,
      pinnedCollapsed,
      sortMode,
      collapsedProjectKeys: normalizedQuery ? new Set<string>() : collapsedProjectKeys,
      collapsedWorkspaceGroupKeys,
    }),
    [
      collapsedProjectKeys,
      normalizedQuery,
      collapsedWorkspaceGroupKeys,
      groupMode,
      list.projectNamesByViewKey,
      sortMode,
      orderedProjects,
      pinnedCollapsed,
      pinnedKeys,
      pinnedWorkspaceOrder,
      filteredWorkspaceEntriesByKey,
    ],
  );
  const projection = useMemo(() => buildSidebarProjection(projectionInput), [projectionInput]);
  const value = useMemo(
    () => ({
      ...list,
      projects: orderedProjects,
      allProjects: list.projects,
      resolvedProjectFilters,
      hasProjectsBeforeFilter: list.projects.length > 0,
      searchQuery,
      setSearchQuery,
      sortMode,
      setSortMode,
      olderMessageSortHosts: olderSortHosts,
      workspaceEntriesByKey: filteredWorkspaceEntriesByKey,
      groupMode,
      mineOnly,
      mineHiddenCount,
      workspaceGroups: projection.workspaceGroups,
      sessionRows,
      tabRows,
      projectIconTargets: projection.projectIconTargets,
      pinnedGroups: projection.pinnedGroups,
      pinnedProjectViewKeys: pinOrdered.pinnedViewKeys,
      collapsedProjectKeys: normalizedQuery ? new Set<string>() : collapsedProjectKeys,
      toggleProjectCollapsed,
      shortcutModel: projection.shortcutModel,
    }),
    [
      resolvedProjectFilters,
      collapsedProjectKeys,
      normalizedQuery,
      searchQuery,
      sortMode,
      setSortMode,
      olderSortHosts,
      groupMode,
      mineOnly,
      mineHiddenCount,
      list,
      orderedProjects,
      pinOrdered.pinnedViewKeys,
      projection,
      sessionRows,
      tabRows,
      toggleProjectCollapsed,
      filteredWorkspaceEntriesByKey,
    ],
  );

  return (
    <SidebarModelContext.Provider value={value}>
      <SidebarTabMatchesProvider tabMatches={tabMatches} uniqueSession={uniqueSession}>
        <SidebarMessageSearchProvider
          rawQuery={searchQuery}
          normalizedQuery={normalizedQuery}
          scope={messageSearchScope}
          messagesEnabled={filterScope === "messages"}
        >
          {children}
        </SidebarMessageSearchProvider>
      </SidebarTabMatchesProvider>
    </SidebarModelContext.Provider>
  );
}

export function useSidebarModel(): SidebarModel {
  const model = useContext(SidebarModelContext);
  if (!model) throw new Error("SidebarModelProvider is required");
  return model;
}
