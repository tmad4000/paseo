import { useEffect, useMemo, useSyncExternalStore } from "react";
import { BackHandler } from "react-native";
import { router, type Href, usePathname } from "expo-router";
import { useIsCompactFormFactor } from "@/constants/layout";
import { getIsElectron, isNative, isWeb } from "@/constants/platform";
import { listenToDesktopEvent } from "@/desktop/electron/events";
import {
  useWorkspaceLayoutStore,
  useWorkspaceLayoutStoreHydrated,
} from "@/stores/workspace-layout-store";
import { usePanelStore } from "@/stores/panel-store";
import { useRecentVisitsStore } from "@/stores/recent-visits-store";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { parseHostWorkspaceRouteFromPathname } from "@/utils/host-routes";
import {
  navigationFocusHistory,
  navigationFocusLocationsShareRoute,
  type NavigationFocusHistoryDirection,
  type NavigationFocusLocation,
  type NavigationViewState,
} from "./focus-history";

import {
  buildWorkspaceFocusLocation,
  restoreNavigationFocusLocation,
  focusHistoryDirectionForMouseButton,
  parseDesktopNavigationDirection,
  createGestureDeduper,
} from "./focus-history-actions";

export {
  buildWorkspaceFocusLocation,
  restoreNavigationFocusLocation,
  focusHistoryDirectionForMouseButton,
  parseDesktopNavigationDirection,
  createGestureDeduper,
  type RestoreNavigationFocusLocationDeps,
} from "./focus-history-actions";

const TRACKED_APP_ROUTE_PREFIXES = [
  "/settings",
  "/new",
  "/open-project",
  "/sessions",
  "/schedules",
  "/views",
  "/pair-scan",
] as const;

function getTrackableRouteLocation(pathname: string): NavigationFocusLocation | null {
  if (!TRACKED_APP_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return null;
  }
  return { kind: "route", pathname };
}

function resolveNavigationPanel(input: {
  isCompact: boolean;
  mobilePanel: NavigationViewState["panel"];
}): NavigationViewState["panel"] {
  if (input.isCompact) {
    // The agent list is transient navigation chrome. Selecting a workspace from
    // it should return to the prior workspace, not reopen the drawer first.
    return input.mobilePanel === "agent-list" ? "agent" : input.mobilePanel;
  }
  // On desktop the explorer is a sidebar pane inside the workspace layout, which the
  // pane/tab focus already captures.
  return "agent";
}

// A restore normally confirms itself when the tracker observes the restored route.
// One that changes nothing on screen (tab already focused, or since closed) never
// does, so stop waiting: quickly within a workspace, generously across routes, which
// may load from a remote host.
const SAME_ROUTE_SETTLE_MS = 250;
const CROSS_ROUTE_SETTLE_MS = 4000;

let latestObservedLocation: NavigationFocusLocation | null = null;
let settleTimer: ReturnType<typeof setTimeout> | null = null;

export function navigateInFocusHistory(
  direction: NavigationFocusHistoryDirection,
  input: { isCompact: boolean; steps?: number },
): boolean {
  // A second press while the first is still landing belongs to history, not to
  // whatever fallback the caller runs when there is nowhere to go.
  if (navigationFocusHistory.getSnapshot().restoring) {
    return true;
  }
  const steps = input.steps ?? 1;
  const location =
    direction === "back"
      ? navigationFocusHistory.back(steps)
      : navigationFocusHistory.forward(steps);
  if (!location) {
    return false;
  }
  const sameRoute =
    latestObservedLocation !== null &&
    navigationFocusLocationsShareRoute(latestObservedLocation, location);

  try {
    const workspaceLayout = useWorkspaceLayoutStore.getState();
    restoreNavigationFocusLocation(location, {
      navigateWorkspace: navigateToWorkspace,
      navigateRoute: (pathname) => router.navigate(pathname as Href),
      focusPane: workspaceLayout.focusPane,
      focusTab: workspaceLayout.focusTab,
      restoreView: (view) =>
        usePanelStore.getState().restoreNavigationView({
          isCompact: input.isCompact,
          ...view,
        }),
    });
  } catch {
    navigationFocusHistory.cancelRestore();
    return false;
  }

  if (settleTimer) {
    clearTimeout(settleTimer);
  }
  settleTimer = setTimeout(
    () => {
      settleTimer = null;
      navigationFocusHistory.settleRestore(latestObservedLocation);
    },
    sameRoute ? SAME_ROUTE_SETTLE_MS : CROSS_ROUTE_SETTLE_MS,
  );
  return true;
}

export function navigateBackInFocusHistory(input: { isCompact: boolean }): boolean {
  return navigateInFocusHistory("back", input);
}

export function navigateForwardInFocusHistory(input: { isCompact: boolean }): boolean {
  return navigateInFocusHistory("forward", input);
}

export function useCanNavigateBackInFocusHistory(): boolean {
  return useSyncExternalStore(
    navigationFocusHistory.subscribe,
    () => navigationFocusHistory.getSnapshot().canGoBack,
    () => navigationFocusHistory.getSnapshot().canGoBack,
  );
}

export function useFocusHistoryEntries(
  direction: NavigationFocusHistoryDirection,
): readonly NavigationFocusLocation[] {
  return useSyncExternalStore(
    navigationFocusHistory.subscribe,
    () => navigationFocusHistory.getSnapshot()[`${direction}Entries`],
    () => navigationFocusHistory.getSnapshot()[`${direction}Entries`],
  );
}

export function useCanNavigateForwardInFocusHistory(): boolean {
  return useSyncExternalStore(
    navigationFocusHistory.subscribe,
    () => navigationFocusHistory.getSnapshot().canGoForward,
    () => navigationFocusHistory.getSnapshot().canGoForward,
  );
}

export function useNavigationFocusHistoryTracker({ enabled }: { enabled: boolean }): void {
  const pathname = usePathname();
  const isCompact = useIsCompactFormFactor();
  const hasHydratedWorkspaceLayoutStore = useWorkspaceLayoutStoreHydrated();
  const workspaceSelection = useMemo(
    () => parseHostWorkspaceRouteFromPathname(pathname),
    [pathname],
  );
  const workspaceKey = workspaceSelection
    ? buildWorkspaceTabPersistenceKey(workspaceSelection)
    : null;
  const layout = useWorkspaceLayoutStore((state) =>
    workspaceKey ? (state.layoutByWorkspace[workspaceKey] ?? null) : null,
  );
  const mobilePanel = usePanelStore((state) => state.mobilePanel.target);
  const explorerTab = usePanelStore((state) => state.explorerTab);
  const view = useMemo<NavigationViewState>(
    () => ({
      panel: resolveNavigationPanel({ isCompact, mobilePanel }),
      explorerTab,
    }),
    [explorerTab, isCompact, mobilePanel],
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }
    if (workspaceSelection) {
      if (!hasHydratedWorkspaceLayoutStore) {
        useRecentVisitsStore.getState().touch({ ...workspaceSelection, agentId: null });
        return;
      }
      const location = buildWorkspaceFocusLocation({
        ...workspaceSelection,
        layout,
        view,
      });
      latestObservedLocation = location;
      useRecentVisitsStore.getState().touch({
        serverId: location.serverId,
        workspaceId: location.workspaceId,
        agentId: location.target?.kind === "agent" ? location.target.agentId : null,
      });
      navigationFocusHistory.record(location);
      return;
    }

    latestObservedLocation = getTrackableRouteLocation(pathname);
    if (latestObservedLocation) {
      navigationFocusHistory.record(latestObservedLocation);
    }
  }, [enabled, hasHydratedWorkspaceLayoutStore, layout, pathname, view, workspaceSelection]);
}

export function useNativeNavigationBackHandler({ enabled }: { enabled: boolean }): void {
  const isCompact = useIsCompactFormFactor();
  const mobilePanel = usePanelStore((state) => state.mobilePanel.target);
  const showMobileAgent = usePanelStore((state) => state.showMobileAgent);

  useEffect(() => {
    if (!enabled || !isNative) {
      return;
    }
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (isCompact && mobilePanel === "agent-list") {
        showMobileAgent();
        return true;
      }
      return navigateBackInFocusHistory({ isCompact });
    });
    return () => subscription.remove();
  }, [enabled, isCompact, mobilePanel, showMobileAgent]);
}

/**
 * Mouse side buttons on web and desktop, plus the desktop window's swipe and
 * app-command gestures, which the Electron main process forwards.
 */
export function useNavigationGestureHandlers({ enabled }: { enabled: boolean }): void {
  const isCompact = useIsCompactFormFactor();

  useEffect(() => {
    if (!enabled || !isWeb || typeof window === "undefined") {
      return;
    }
    const acceptGesture = createGestureDeduper();
    const navigate = (direction: NavigationFocusHistoryDirection): boolean =>
      acceptGesture(direction) && navigateInFocusHistory(direction, { isCompact });

    // Browsers navigate their own history on mouseup of a side button; take it over
    // only when there is somewhere to go, so the browser default still applies otherwise.
    const handleMouseUp = (event: MouseEvent) => {
      const direction = focusHistoryDirectionForMouseButton(event.button);
      if (!direction) {
        return;
      }
      const snapshot = navigationFocusHistory.getSnapshot();
      const available =
        snapshot.restoring || (direction === "back" ? snapshot.canGoBack : snapshot.canGoForward);
      if (!available) {
        return;
      }
      event.preventDefault();
      navigate(direction);
    };
    window.addEventListener("mouseup", handleMouseUp);

    let disposed = false;
    let unlisten: (() => void) | null = null;
    const listenForWindowGestures = async () => {
      try {
        const dispose = await listenToDesktopEvent<unknown>("navigate-history", (payload) => {
          const direction = parseDesktopNavigationDirection(payload);
          if (direction) {
            navigate(direction);
          }
        });
        if (disposed) {
          dispose();
        } else {
          unlisten = dispose;
        }
      } catch {
        // No desktop bridge; mouse buttons still work.
      }
    };
    if (getIsElectron()) {
      void listenForWindowGestures();
    }

    return () => {
      disposed = true;
      window.removeEventListener("mouseup", handleMouseUp);
      unlisten?.();
    };
  }, [enabled, isCompact]);
}
