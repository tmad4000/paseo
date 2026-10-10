import { create } from "zustand";
import { joinSubtitleParts } from "@/command-center/results";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { useRecentVisitsStore } from "@/stores/recent-visits-store";
import { useSessionStore } from "@/stores/session-store";
import { selectWorkspace } from "@/stores/session-store-hooks/selectors";
import {
  buildRecentWorkspaceEntries,
  initialRecentWorkspaceIndex,
  recentWorkspacesFromVisits,
  stepRecentWorkspaceIndex,
  type RecentWorkspaceEntry,
  type RecentWorkspaceKeyInput,
  type RecentWorkspaceLabels,
} from "./recent-workspaces";

interface RecentWorkspaceSwitcherState {
  open: boolean;
  entries: readonly RecentWorkspaceEntry[];
  index: number;
}

export const useRecentWorkspaceSwitcherStore = create<RecentWorkspaceSwitcherState>()(() => ({
  open: false,
  entries: [],
  index: 0,
}));

export function recentWorkspaceLabelsFromSessions(
  workspace: RecentWorkspaceKeyInput,
): RecentWorkspaceLabels | null {
  const descriptor = selectWorkspace(
    useSessionStore.getState(),
    workspace.serverId,
    workspace.workspaceId,
  );
  if (!descriptor || descriptor.archivingAt) {
    return null;
  }
  return {
    title: descriptor.title ?? descriptor.name,
    subtitle: joinSubtitleParts([
      descriptor.projectCustomName ?? descriptor.projectDisplayName,
      descriptor.gitRuntime?.currentBranch,
    ]),
  };
}

export function getRecentWorkspaceEntries(
  current: RecentWorkspaceKeyInput | null,
): RecentWorkspaceEntry[] {
  return buildRecentWorkspaceEntries({
    recent: recentWorkspacesFromVisits(useRecentVisitsStore.getState().visits),
    current,
    labelsOf: recentWorkspaceLabelsFromSessions,
  });
}

function switchToEntry(entry: RecentWorkspaceEntry | undefined): void {
  if (!entry || entry.isCurrent) {
    return;
  }
  navigateToWorkspace({ serverId: entry.serverId, workspaceId: entry.workspaceId });
}

/**
 * Ctrl+Tab. With `hold`, the switcher stays open while Control is held and commits
 * on release, so a quick tap lands on the previous workspace and holding cycles.
 * Without it (the keystroke came from an embedded browser page, whose key-up the
 * app never sees) it switches straight away.
 */
export function openRecentWorkspaceSwitcher(input: {
  direction: 1 | -1;
  current: RecentWorkspaceKeyInput | null;
  hold: boolean;
}): boolean {
  const entries = getRecentWorkspaceEntries(input.current);
  const index = initialRecentWorkspaceIndex(entries, input.direction);
  if (index === null) {
    return false;
  }
  if (!input.hold) {
    switchToEntry(entries[index]);
    return true;
  }
  useRecentWorkspaceSwitcherStore.setState({ open: true, entries, index });
  return true;
}

export function stepRecentWorkspaceSwitcher(delta: 1 | -1): void {
  const state = useRecentWorkspaceSwitcherStore.getState();
  if (!state.open) {
    return;
  }
  useRecentWorkspaceSwitcherStore.setState({
    index: stepRecentWorkspaceIndex(state.index, delta, state.entries.length),
  });
}

export function highlightRecentWorkspace(index: number): void {
  const state = useRecentWorkspaceSwitcherStore.getState();
  if (state.open && index >= 0 && index < state.entries.length && index !== state.index) {
    useRecentWorkspaceSwitcherStore.setState({ index });
  }
}

export function closeRecentWorkspaceSwitcher(): void {
  if (useRecentWorkspaceSwitcherStore.getState().open) {
    useRecentWorkspaceSwitcherStore.setState({ open: false, entries: [], index: 0 });
  }
}

export function commitRecentWorkspaceSwitcher(index?: number): void {
  const state = useRecentWorkspaceSwitcherStore.getState();
  if (!state.open) {
    return;
  }
  const entry = state.entries[index ?? state.index];
  closeRecentWorkspaceSwitcher();
  switchToEntry(entry);
}

/** Keys while the switcher is open. Returns true when the key belonged to the switcher. */
export function handleRecentWorkspaceSwitcherKeyDown(event: {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
}): boolean {
  if (!useRecentWorkspaceSwitcherStore.getState().open) {
    return false;
  }
  // Control was released without a key-up reaching us (focus churn): finish the
  // gesture as the release would have, and let this key do its normal job.
  if (!event.ctrlKey && event.key !== "Control" && event.key !== "Escape") {
    commitRecentWorkspaceSwitcher();
    return false;
  }
  switch (event.key) {
    case "Tab":
      stepRecentWorkspaceSwitcher(event.shiftKey ? -1 : 1);
      return true;
    case "ArrowDown":
      stepRecentWorkspaceSwitcher(1);
      return true;
    case "ArrowUp":
      stepRecentWorkspaceSwitcher(-1);
      return true;
    case "Enter":
      commitRecentWorkspaceSwitcher();
      return true;
    case "Escape":
      closeRecentWorkspaceSwitcher();
      return true;
    case "Control":
    case "Shift":
      return true;
    default:
      // Any other key ends the gesture without switching, so it cannot swallow typing.
      closeRecentWorkspaceSwitcher();
      return false;
  }
}

export function handleRecentWorkspaceSwitcherKeyUp(event: { key: string }): boolean {
  if (!useRecentWorkspaceSwitcherStore.getState().open || event.key !== "Control") {
    return false;
  }
  commitRecentWorkspaceSwitcher();
  return true;
}
