import {
  collectAllTabs,
  findPaneById,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-actions";
import type { navigateToWorkspace } from "@/stores/navigation-active-workspace-store/navigation";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import type {
  NavigationFocusHistoryDirection,
  NavigationFocusLocation,
  NavigationViewState,
  WorkspaceFocusLocation,
} from "./focus-history";

export function buildWorkspaceFocusLocation(input: {
  serverId: string;
  workspaceId: string;
  layout: WorkspaceLayout | null;
  view: NavigationViewState;
}): WorkspaceFocusLocation {
  const pane = input.layout ? findPaneById(input.layout.root, input.layout.focusedPaneId) : null;
  const tab =
    input.layout && pane?.focusedTabId
      ? (collectAllTabs(input.layout.root).find(
          (candidate) => candidate.tabId === pane.focusedTabId,
        ) ?? null)
      : null;
  return {
    kind: "workspace",
    serverId: input.serverId,
    workspaceId: input.workspaceId,
    paneId: pane?.id ?? null,
    tabId: tab?.tabId ?? null,
    target: tab?.target ?? null,
    view: input.view,
  };
}

export interface RestoreNavigationFocusLocationDeps {
  navigateWorkspace: typeof navigateToWorkspace;
  navigateRoute: (pathname: string) => void;
  focusPane: (workspaceKey: string, paneId: string) => void;
  focusTab: (workspaceKey: string, tabId: string) => void;
  restoreView: (view: NavigationViewState) => void;
}

export function restoreNavigationFocusLocation(
  location: NavigationFocusLocation,
  deps: RestoreNavigationFocusLocationDeps,
): void {
  if (location.kind === "route") {
    deps.navigateRoute(location.pathname);
    return;
  }

  // Empty tabs have an instance id, not a reopenable resource identity. Route
  // without opening a target or an attention agent, then focus that exact id.
  const preserveTabFocus = location.target?.kind === "new_tab";
  const target = preserveTabFocus ? null : location.target;
  deps.navigateWorkspace({
    serverId: location.serverId,
    workspaceId: location.workspaceId,
    ...(target ? { target } : {}),
    ...(preserveTabFocus ? { preserveTabFocus: true } : {}),
  });

  const workspaceKey = buildWorkspaceTabPersistenceKey(location);
  if (workspaceKey && location.tabId) {
    deps.focusTab(workspaceKey, location.tabId);
  } else if (workspaceKey && location.paneId) {
    deps.focusPane(workspaceKey, location.paneId);
  }
  deps.restoreView(location.view);
}

// Mouse side buttons, as in a browser: 3 is Back, 4 is Forward.
export function focusHistoryDirectionForMouseButton(
  button: number,
): NavigationFocusHistoryDirection | null {
  if (button === 3) {
    return "back";
  }
  if (button === 4) {
    return "forward";
  }
  return null;
}

export function parseDesktopNavigationDirection(
  payload: unknown,
): NavigationFocusHistoryDirection | null {
  const direction =
    typeof payload === "object" && payload !== null && "direction" in payload
      ? (payload as { direction: unknown }).direction
      : null;
  return direction === "back" || direction === "forward" ? direction : null;
}

// On Windows one side-button press reaches the page as a mouse event and the window
// as an app command; act on whichever arrives first.
const DUPLICATE_GESTURE_WINDOW_MS = 300;

export function createGestureDeduper(now: () => number = Date.now) {
  let last: { direction: NavigationFocusHistoryDirection; at: number } | null = null;
  return (direction: NavigationFocusHistoryDirection): boolean => {
    const at = now();
    if (last && last.direction === direction && at - last.at < DUPLICATE_GESTURE_WINDOW_MS) {
      return false;
    }
    last = { direction, at };
    return true;
  };
}

