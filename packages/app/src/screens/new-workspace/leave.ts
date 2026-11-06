import { router, type Href } from "expo-router";
import { navigateBackInFocusHistory } from "@/navigation/focus-history-runtime";
import { navigateToLastWorkspace } from "@/stores/navigation-active-workspace-store";
import { buildOpenProjectRoute } from "@/utils/host-routes";

export interface LeaveNewWorkspaceDeps {
  navigateBack: (input: { isCompact: boolean }) => boolean;
  navigateToLastWorkspace: () => boolean;
  replaceRoute: (route: string) => void;
}

const defaultDeps: LeaveNewWorkspaceDeps = {
  navigateBack: navigateBackInFocusHistory,
  navigateToLastWorkspace,
  replaceRoute: (route) => router.replace(route as Href),
};

/**
 * Close the New workspace screen (its Close button and Cmd/Ctrl+W): go back to where the user
 * was, else to the last workspace, else to Open project. Nothing is archived or closed, and the
 * typed draft stays in the persisted draft store for the next visit.
 */
export function leaveNewWorkspaceScreen(
  input: { isCompact: boolean },
  deps: LeaveNewWorkspaceDeps = defaultDeps,
): void {
  if (deps.navigateBack(input)) {
    return;
  }
  if (deps.navigateToLastWorkspace()) {
    return;
  }
  deps.replaceRoute(buildOpenProjectRoute());
}
