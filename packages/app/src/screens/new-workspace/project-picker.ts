import { useCallback, useEffect, useMemo, useState } from "react";
import type { ComboboxOption as ComboboxOptionType } from "@/components/ui/combobox";
import { orderProjectsWithPins, type ProjectPinState } from "@/default-project/model";
import { isWorkspaceArchivePending } from "@/contexts/session-workspace-upserts";
import {
  filterWorkspaceProjectsForHost,
  getHostProjectSourceDirectory,
  resolveInitialWorkspaceProject,
  type HostProjectListItem,
} from "@/projects/host-projects";
import {
  createManualProjectSelectionContextKey,
  createProjectSelectionContextKey,
  createProjectSelection,
  reconcileProjectSelection,
  resolveInitialProjectSelectionSource,
  resolveProjectSelection,
  type ProjectSelection,
  type ProjectSelectionContext,
} from "./project-selection";

const PROJECT_OPTION_PREFIX = "project:";

interface NewWorkspaceProjectPickerInput {
  selectedServerId: string;
  projects: HostProjectListItem[];
  routeProject: HostProjectListItem | null;
  routeProjectContextViewKey: string | null;
  lastActiveProject: HostProjectListItem | null;
  allowAllProjects: boolean;
  /** Pinned projects are listed first; without it the picker keeps the given order. */
  pinOrdering?: {
    pinStates: ReadonlyMap<string, ProjectPinState>;
    pinnedProjectOrder: readonly string[];
  };
}

interface NewWorkspaceProjectPickerState {
  selectedProject: HostProjectListItem | null;
  selectedSourceDirectory: string | null;
  projectPickerOptions: ComboboxOptionType[];
  projectByOptionId: Map<string, HostProjectListItem>;
  /** Option ids of pinned and Default projects, which lead the option list. */
  pinnedOptionIds: ReadonlySet<string>;
  selectedProjectOptionId: string;
  projectTriggerLabel: string;
  handleSelectProjectOption: (id: string) => void;
}

function projectOptionId(projectId: string): string {
  return `${PROJECT_OPTION_PREFIX}${projectId}`;
}

const NO_PINNED_OPTION_IDS: ReadonlySet<string> = new Set();

/**
 * Picker options in display order. Pins only reorder the list: the initial selection still comes
 * from the route or the last active project, never from whichever project is pinned first.
 */
export function computeProjectOptionData(
  projects: readonly HostProjectListItem[],
  pinOrdering?: NewWorkspaceProjectPickerInput["pinOrdering"],
) {
  const ordered = pinOrdering
    ? orderProjectsWithPins({ projects, ...pinOrdering })
    : { projects, pinnedViewKeys: NO_PINNED_OPTION_IDS };
  const projectByOptionId = new Map<string, HostProjectListItem>();
  const options = ordered.projects.map((project) => {
    const id = projectOptionId(project.viewKey);
    projectByOptionId.set(id, project);
    return { id, label: project.projectName };
  });
  const pinnedOptionIds =
    ordered.pinnedViewKeys.size === 0
      ? NO_PINNED_OPTION_IDS
      : new Set(Array.from(ordered.pinnedViewKeys, projectOptionId));
  return { options, projectByOptionId, pinnedOptionIds };
}

function resolveWorkspaceIdFromProjectWorkspaceKey(input: {
  selectedServerId: string;
  workspaceKey: string;
}): string | null {
  const prefix = `${input.selectedServerId}:`;
  return input.workspaceKey.startsWith(prefix) ? input.workspaceKey.slice(prefix.length) : null;
}

function hasPendingArchiveForProject(input: {
  selectedServerId: string;
  project: HostProjectListItem;
}): boolean {
  for (const workspaceKey of input.project.workspaceKeys) {
    const workspaceId = resolveWorkspaceIdFromProjectWorkspaceKey({
      selectedServerId: input.selectedServerId,
      workspaceKey,
    });
    if (
      workspaceId &&
      isWorkspaceArchivePending({ serverId: input.selectedServerId, workspaceId })
    ) {
      return true;
    }
  }

  return false;
}

export function useNewWorkspaceProjectPicker({
  selectedServerId,
  projects,
  routeProject,
  routeProjectContextViewKey,
  lastActiveProject,
  allowAllProjects,
  pinOrdering,
}: NewWorkspaceProjectPickerInput): NewWorkspaceProjectPickerState {
  const selectableProjects = useMemo(
    () =>
      filterWorkspaceProjectsForHost({ projects, serverId: selectedServerId, allowAllProjects }),
    [allowAllProjects, projects, selectedServerId],
  );
  const initialProject = useMemo(
    () =>
      resolveInitialWorkspaceProject({
        routeProject,
        lastActiveProject,
        projects: selectableProjects,
        serverId: selectedServerId,
        allowAllProjects,
      }),
    [allowAllProjects, lastActiveProject, routeProject, selectableProjects, selectedServerId],
  );

  const selectionContextKey = createProjectSelectionContextKey({
    selectedServerId,
    routeProjectViewKey: routeProjectContextViewKey,
    allowAllProjects,
  });
  const manualSelectionContextKey = createManualProjectSelectionContextKey({
    routeProjectViewKey: routeProjectContextViewKey,
  });
  const shouldPreserveMissingProject = useCallback(
    (project: HostProjectListItem) =>
      hasPendingArchiveForProject({
        selectedServerId,
        project,
      }),
    [selectedServerId],
  );
  const selectionContext = useMemo<ProjectSelectionContext>(
    () => ({
      contextKey: selectionContextKey,
      manualContextKey: manualSelectionContextKey,
      selectedServerId,
      initialProject,
      initialProjectSource: resolveInitialProjectSelectionSource({
        initialProject,
        routeProject,
        lastActiveProject,
      }),
      projects: selectableProjects,
      routeProject,
      lastActiveProject,
      shouldPreserveMissingProject,
    }),
    [
      initialProject,
      lastActiveProject,
      manualSelectionContextKey,
      routeProject,
      selectableProjects,
      selectedServerId,
      selectionContextKey,
      shouldPreserveMissingProject,
    ],
  );
  const [projectSelection, setProjectSelection] = useState<ProjectSelection>(() =>
    createProjectSelection(selectionContext),
  );

  useEffect(() => {
    setProjectSelection((current) => reconcileProjectSelection(current, selectionContext));
  }, [selectionContext]);

  const activeSelection = reconcileProjectSelection(projectSelection, selectionContext);
  const selectedProject = resolveProjectSelection(activeSelection, selectionContext);
  const {
    options: projectPickerOptions,
    projectByOptionId,
    pinnedOptionIds,
  } = useMemo(
    () => computeProjectOptionData(selectableProjects, pinOrdering),
    [pinOrdering, selectableProjects],
  );
  const handleSelectProjectOption = useCallback(
    (id: string) => {
      const project = projectByOptionId.get(id);
      if (!project) return;
      if (
        !allowAllProjects &&
        !project.hosts.some((host) => host.worktreeSupport !== "unsupported")
      )
        return;
      setProjectSelection({
        contextKey: manualSelectionContextKey,
        project,
        originProject: project,
        source: "manual",
      });
    },
    [allowAllProjects, manualSelectionContextKey, projectByOptionId],
  );

  return {
    selectedProject,
    selectedSourceDirectory: selectedProject
      ? getHostProjectSourceDirectory(selectedProject, selectedServerId)
      : null,
    projectPickerOptions,
    projectByOptionId,
    pinnedOptionIds,
    selectedProjectOptionId: selectedProject ? projectOptionId(selectedProject.viewKey) : "",
    projectTriggerLabel: selectedProject?.projectName ?? "Choose project",
    handleSelectProjectOption,
  };
}
