import { useCallback, useMemo, useState } from "react";
import { useFormPreferences } from "@/hooks/use-form-preferences";
import { useHostProjects, type HostProjectListItem } from "@/projects/host-projects";
import { useHostFeature } from "@/runtime/host-features";
import { useHosts } from "@/runtime/host-runtime";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { useWorkspace } from "@/stores/session-store-hooks";
import type { HostProfile } from "@/types/host-connection";
import {
  projectChoiceOfDestination,
  resolveProjectServerId,
  resolveQuickLaunchDefaultDestination,
  resolveQuickLaunchSelection,
  workspaceOfDestination,
  type QuickLaunchProjectChoice,
  type QuickLaunchSelection,
  type QuickLaunchWhere,
  type QuickLaunchWorkspaceRef,
} from "./destination";
import type { QuickLaunchRequest } from "./store";

export interface QuickLaunchDestinationState extends QuickLaunchSelection {
  hosts: HostProfile[];
  projects: HostProjectListItem[];
  /** The host whose projects the picker lists. */
  projectServerId: string;
  /** The workspace "New tab in" points at, when there is one. */
  tabWorkspace: WorkspaceDescriptor | null;
  setWhere: (where: QuickLaunchWhere) => void;
  selectProject: (projectViewKey: string) => void;
  selectHost: (serverId: string) => void;
}

/** The dialog's destination choices. They live for one open; nothing is remembered. */
export function useQuickLaunchDestination(input: {
  request: QuickLaunchRequest;
  active: QuickLaunchWorkspaceRef | null;
}): QuickLaunchDestinationState {
  const { request, active } = input;
  const hosts = useHosts();
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const projects = useHostProjects(serverIds);

  const requestedWorkspace = workspaceOfDestination(request.destination);
  const tabRef = requestedWorkspace ?? active;
  const tabWorkspace = useWorkspace(tabRef?.serverId ?? null, tabRef?.workspaceId ?? null);
  const [where, setWhere] = useState<QuickLaunchWhere>(
    requestedWorkspace ? "existing-workspace" : "new-workspace",
  );

  const defaultDestination = useMemo(
    () => resolveQuickLaunchDefaultDestination({ projects, serverIds, active }),
    [active, projects, serverIds],
  );
  const [manualProject, setManualProject] = useState<QuickLaunchProjectChoice | null>(() =>
    projectChoiceOfDestination(request.destination),
  );
  const projectChoice = manualProject ?? defaultDestination;
  const projectServerId = resolveProjectServerId({ choice: projectChoice, active, serverIds });
  // COMPAT(workspaceMultiplicity): added in v0.1.97, drop the gate when floor >= v0.1.97
  const supportsMultiplicity = useHostFeature(projectServerId, "workspaceMultiplicity");
  const { preferences } = useFormPreferences();

  const selection = resolveQuickLaunchSelection({
    where,
    tabWorkspace:
      tabRef && tabWorkspace
        ? { ...tabRef, workspaceDirectory: tabWorkspace.workspaceDirectory }
        : null,
    projects,
    projectChoice,
    projectServerId,
    supportsMultiplicity,
    isolation: preferences.isolation ?? "local",
  });

  const selectProject = useCallback(
    (projectViewKey: string) => {
      setManualProject({ serverId: projectServerId, projectViewKey });
    },
    [projectServerId],
  );
  const chosenOnHost = selection.where === "new-workspace" ? selection.shownProject : null;
  const selectHost = useCallback(
    (nextServerId: string) => {
      if (chosenOnHost?.hosts.some((host) => host.serverId === nextServerId)) {
        setManualProject({ serverId: nextServerId, projectViewKey: chosenOnHost.viewKey });
        return;
      }
      const hostDefault = resolveQuickLaunchDefaultDestination({
        projects,
        serverIds: [nextServerId],
        active: null,
      });
      setManualProject(hostDefault ?? { serverId: nextServerId, projectViewKey: null });
    },
    [chosenOnHost, projects],
  );

  return {
    ...selection,
    hosts,
    projects,
    projectServerId,
    tabWorkspace,
    setWhere,
    selectProject,
    selectHost,
  };
}
