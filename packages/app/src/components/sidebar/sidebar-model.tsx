import { useShallow } from "zustand/react/shallow";
import { shallow } from "zustand/shallow";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { effectiveSidebarSortMode, messageSortAvailability } from "./message-sort-capability";
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
import {
  hasAuthoritativeWorkspaceLabelCatalog,
  useWorkspaceLabelProjection,
} from "@/workspace-labels";

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
  messageSortAvailability: "ready" | "loading" | "unsupported";
  setSortMode: (mode: SidebarSortMode) => void;
  groupMode: SidebarGroupMode;
  workspaceGroups: SidebarWorkspaceGroup[];
  projectIconTargets: SidebarProjectIconTarget[];
  pinnedGroups: PinnedSidebarGroups;
  collapsedProjectKeys: ReadonlySet<string>;
  toggleProjectCollapsed: (projectViewKey: string) => void;
  shortcutModel: SidebarShortcutModel;
}

const SidebarModelContext = createContext<SidebarModel | null>(null);

const NO_AGENT_MAPS: ReadonlyArray<ReadonlyMap<string, Agent> | undefined> = [];

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
  const [searchQuery, setSearchQuery] = useState("");
  const sortMode = useSidebarViewStore((state) => state.sortMode);
  const setSortMode = useSidebarViewStore((state) => state.setSortMode);
  const hostMessageActivitySupport = useSessionStore(
    useShallow((state) =>
      list.serverIds.map((serverId) => {
        const info = state.sessions[serverId]?.serverInfo;
        return info ? info.features?.conversationMessageActivity === true : undefined;
      }),
    ),
  );
  const sortAvailability = messageSortAvailability(hostMessageActivitySupport);
  const effectiveSort = effectiveSidebarSortMode(sortMode, sortAvailability);
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
    Boolean(normalizedQuery) ||
    sortMode !== "manual";
  const workspaceEntriesByKey = useSidebarWorkspaceEntries(
    list.workspacePlacements,
    active !== false || needsWorkspaceEntries,
  );
  const tabMatches = useSidebarTabMatches(list.serverIds, normalizedQuery);
  const tabMatchedWorkspaceKeys = useMemo(() => new Set(tabMatches.keys()), [tabMatches]);
  // Project and label filters, before the text query: what the query's tiers may search.
  const scopedWorkspaces = useMemo(() => {
    const byProject = filterWorkspacesByProjects({
      workspaces: [...workspaceEntriesByKey.values()],
      projectFilters: resolvedProjectFilters,
    });
    return filterWorkspacesByLabels({ workspaces: byProject, ...labelFilter });
  }, [labelFilter, resolvedProjectFilters, workspaceEntriesByKey]);
  const filteredWorkspaceEntriesByKey = useMemo(() => {
    const filtered = scopedWorkspaces.filter((workspace) =>
      workspaceMatchesSidebarFilter(workspace, normalizedQuery, tabMatchedWorkspaceKeys),
    );
    const sorted = sortSidebarWorkspaces(filtered, workspaceEntriesByKey, effectiveSort);
    return new Map(sorted.map((workspace) => [workspace.workspaceKey, workspace]));
  }, [
    normalizedQuery,
    effectiveSort,
    scopedWorkspaces,
    tabMatchedWorkspaceKeys,
    workspaceEntriesByKey,
  ]);
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
  const visibleWorkspaceKeys = useMemo(
    () => new Set(filteredWorkspaceEntriesByKey.keys()),
    [filteredWorkspaceEntriesByKey],
  );
  // The two filters prune differently on purpose. The project filter is a membership test on the
  // project itself, so a project you filtered TO survives even with no workspaces — it still owns
  // a header row you can create your first workspace under. The label filter can only ask about
  // workspaces, so a project it empties has nothing left to show.
  const filteredProjects = useMemo(() => {
    let projects = list.projects;
    if (hasActiveProjectFilter) {
      const included = new Set(resolvedProjectFilters);
      projects = projects.filter((project) => included.has(project.viewKey));
    }
    if (hasActiveLabelFilter || normalizedQuery) {
      projects = projects.flatMap((project) => {
        const workspaces = project.workspaces.filter((workspace) =>
          visibleWorkspaceKeys.has(workspace.workspaceKey),
        );
        const projectNameMatches = project.projectName
          .normalize("NFKC")
          .toLocaleLowerCase()
          .includes(normalizedQuery);
        return workspaces.length > 0 ||
          (!hasActiveLabelFilter && normalizedQuery && projectNameMatches)
          ? [{ ...project, workspaces }]
          : [];
      });
    }
    return filterAndSortSidebarProjects({
      projects,
      entries: filteredWorkspaceEntriesByKey,
      query: normalizedQuery,
      mode: effectiveSort,
      tabMatchedWorkspaceKeys,
    });
  }, [
    hasActiveLabelFilter,
    hasActiveProjectFilter,
    normalizedQuery,
    effectiveSort,
    filteredWorkspaceEntriesByKey,
    resolvedProjectFilters,
    list.projects,
    tabMatchedWorkspaceKeys,
    visibleWorkspaceKeys,
  ]);
  const pinnedKeys = usePinnedSidebarKeys(filteredProjects);
  const projectionInput = useMemo(
    () => ({
      projects: filteredProjects,
      pinnedKeys,
      pinnedWorkspaceOrder,
      workspaceEntriesByKey: filteredWorkspaceEntriesByKey,
      projectNamesByViewKey: list.projectNamesByViewKey,
      groupMode,
      pinnedCollapsed,
      sortMode: effectiveSort,
      collapsedProjectKeys: normalizedQuery ? new Set<string>() : collapsedProjectKeys,
      collapsedWorkspaceGroupKeys,
    }),
    [
      collapsedProjectKeys,
      normalizedQuery,
      collapsedWorkspaceGroupKeys,
      groupMode,
      list.projectNamesByViewKey,
      effectiveSort,
      filteredProjects,
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
      projects: filteredProjects,
      allProjects: list.projects,
      resolvedProjectFilters,
      hasProjectsBeforeFilter: list.projects.length > 0,
      searchQuery,
      setSearchQuery,
      sortMode,
      setSortMode,
      messageSortAvailability: sortAvailability,
      workspaceEntriesByKey: filteredWorkspaceEntriesByKey,
      groupMode,
      workspaceGroups: projection.workspaceGroups,
      projectIconTargets: projection.projectIconTargets,
      pinnedGroups: projection.pinnedGroups,
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
      sortAvailability,
      groupMode,
      list,
      filteredProjects,
      projection,
      toggleProjectCollapsed,
      filteredWorkspaceEntriesByKey,
    ],
  );

  return (
    <SidebarModelContext.Provider value={value}>
      <SidebarTabMatchesProvider tabMatches={tabMatches}>
        <SidebarMessageSearchProvider
          rawQuery={searchQuery}
          normalizedQuery={normalizedQuery}
          scope={messageSearchScope}
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
