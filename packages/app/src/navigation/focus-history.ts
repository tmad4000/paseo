import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import { workspaceTabTargetsEqual } from "@/workspace-tabs/identity";
import type { ExplorerTab, MobilePanelView } from "@/stores/panel-store";

export interface NavigationViewState {
  panel: MobilePanelView;
  explorerTab: ExplorerTab;
}

export interface WorkspaceFocusLocation {
  kind: "workspace";
  serverId: string;
  workspaceId: string;
  paneId: string | null;
  tabId: string | null;
  target: WorkspaceTabTarget | null;
  view: NavigationViewState;
}

export interface RouteFocusLocation {
  kind: "route";
  pathname: string;
}

export type NavigationFocusLocation = WorkspaceFocusLocation | RouteFocusLocation;

export interface NavigationFocusHistorySnapshot {
  /** There is history that way and nothing is in flight; what the buttons show. */
  canGoBack: boolean;
  canGoForward: boolean;
  current: NavigationFocusLocation | null;
  restoring: boolean;
  /** Nearest first: index 0 is one press of Back. */
  backEntries: readonly NavigationFocusLocation[];
  /** Nearest first: index 0 is one press of Forward. */
  forwardEntries: readonly NavigationFocusLocation[];
}

export type NavigationFocusHistoryDirection = "back" | "forward";

const MAX_HISTORY_LENGTH = 50;

function targetsEqual(left: WorkspaceTabTarget | null, right: WorkspaceTabTarget | null): boolean {
  if (!left || !right) {
    return left === right;
  }
  return workspaceTabTargetsEqual(left, right);
}

export function navigationFocusLocationsEqual(
  left: NavigationFocusLocation | null,
  right: NavigationFocusLocation | null,
): boolean {
  if (!left || !right || left.kind !== right.kind) {
    return left === right;
  }
  if (left.kind === "route" && right.kind === "route") {
    return left.pathname === right.pathname;
  }
  if (left.kind !== "workspace" || right.kind !== "workspace") {
    return false;
  }
  return (
    left.serverId === right.serverId &&
    left.workspaceId === right.workspaceId &&
    left.paneId === right.paneId &&
    left.tabId === right.tabId &&
    targetsEqual(left.target, right.target) &&
    left.view.panel === right.view.panel &&
    left.view.explorerTab === right.view.explorerTab
  );
}

export function navigationFocusLocationsShareRoute(
  left: NavigationFocusLocation,
  right: NavigationFocusLocation,
): boolean {
  if (left.kind === "route" && right.kind === "route") {
    return left.pathname === right.pathname;
  }
  return (
    left.kind === "workspace" &&
    right.kind === "workspace" &&
    left.serverId === right.serverId &&
    left.workspaceId === right.workspaceId
  );
}

interface PendingRestore {
  direction: NavigationFocusHistoryDirection;
  steps: number;
  target: NavigationFocusLocation;
  // The stacks as they were before the move, so a restore that never lands can be undone.
  previous: {
    current: NavigationFocusLocation | null;
    past: NavigationFocusLocation[];
    future: NavigationFocusLocation[];
  };
}

/**
 * Browser-style focus history. `past` and `future` are stacks whose last entry is the
 * next Back and Forward target respectively. Moving through history keeps both stacks;
 * focusing anywhere new discards the forward branch, as a browser does.
 */
export function createNavigationFocusHistory(maxLength = MAX_HISTORY_LENGTH) {
  let current: NavigationFocusLocation | null = null;
  let past: NavigationFocusLocation[] = [];
  let future: NavigationFocusLocation[] = [];
  let pending: PendingRestore | null = null;
  let snapshot: NavigationFocusHistorySnapshot = {
    canGoBack: false,
    canGoForward: false,
    current: null,
    restoring: false,
    backEntries: [],
    forwardEntries: [],
  };
  const listeners = new Set<() => void>();

  function publish(): void {
    snapshot = {
      canGoBack: pending === null && past.length > 0,
      canGoForward: pending === null && future.length > 0,
      current,
      restoring: pending !== null,
      backEntries: past.toReversed(),
      forwardEntries: future.toReversed(),
    };
    for (const listener of listeners) {
      listener();
    }
  }

  function push(stack: NavigationFocusLocation[], location: NavigationFocusLocation | null) {
    return location ? [...stack, location].slice(-maxLength) : stack;
  }

  // Several steps at once (from the history menu) pass every skipped entry over to
  // the other stack, so Forward afterwards walks back through them in order.
  function go(
    direction: NavigationFocusHistoryDirection,
    steps: number,
  ): NavigationFocusLocation | null {
    const source = direction === "back" ? past : future;
    if (pending || !Number.isInteger(steps) || steps < 1 || steps > source.length) {
      return null;
    }
    const previous = { current, past, future };
    for (let step = 0; step < steps; step += 1) {
      if (direction === "back") {
        const target = past[past.length - 1] ?? null;
        past = past.slice(0, -1);
        future = push(future, current);
        current = target;
      } else {
        const target = future[future.length - 1] ?? null;
        future = future.slice(0, -1);
        past = push(past, current);
        current = target;
      }
    }
    const target = current;
    if (!target) {
      ({ current, past, future } = previous);
      return null;
    }
    pending = { direction, steps, target, previous };
    publish();
    return target;
  }

  function visit(next: NavigationFocusLocation): boolean {
    if (navigationFocusLocationsEqual(current, next)) {
      return false;
    }
    past = push(past, current);
    future = [];
    current = next;
    return true;
  }

  // Put the stacks back, minus the target that could not be reached, so the next
  // Back or Forward skips it instead of failing on it again.
  function abandon(restore: PendingRestore): void {
    current = restore.previous.current;
    past = restore.previous.past;
    future = restore.previous.future;
    if (restore.direction === "back") {
      const index = past.length - restore.steps;
      past = past.filter((_, position) => position !== index);
    } else {
      const index = future.length - restore.steps;
      future = future.filter((_, position) => position !== index);
    }
  }

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getSnapshot(): NavigationFocusHistorySnapshot {
      return snapshot;
    },

    record(next: NavigationFocusLocation): void {
      if (pending) {
        if (!navigationFocusLocationsShareRoute(next, pending.target)) {
          return;
        }
        // What actually got focus wins over the remembered target (a closed tab
        // resolves to whichever tab the workspace focused instead).
        current = next;
        pending = null;
        publish();
        return;
      }

      if (visit(next)) {
        publish();
      }
    },

    back(steps = 1): NavigationFocusLocation | null {
      return go("back", steps);
    },

    forward(steps = 1): NavigationFocusLocation | null {
      return go("forward", steps);
    },

    /** The restore failed before it could navigate. */
    cancelRestore(): void {
      if (!pending) {
        return;
      }
      abandon(pending);
      pending = null;
      publish();
    },

    /**
     * Stop waiting for the restore to be observed. A restore that changes nothing on
     * screen (its tab already focused, or gone) never produces an observation, and
     * history must not stay locked. `observed` is what is actually focused now: if it
     * is not the target, the target was unreachable, so it is dropped and wherever
     * focus really is gets recorded as an ordinary visit.
     */
    settleRestore(observed: NavigationFocusLocation | null): void {
      if (!pending) {
        return;
      }
      if (observed && !navigationFocusLocationsEqual(observed, pending.target)) {
        abandon(pending);
        visit(observed);
      }
      pending = null;
      publish();
    },

    reset(): void {
      current = null;
      past = [];
      future = [];
      pending = null;
      publish();
    },
  };
}

export type NavigationFocusHistory = ReturnType<typeof createNavigationFocusHistory>;

export const navigationFocusHistory = createNavigationFocusHistory();
