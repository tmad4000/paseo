import { beforeEach, describe, expect, it, vi } from "vitest";

const navigateToWorkspace = vi.fn();
const recentState = {
  visits: [
    { serverId: "s", workspaceId: "current", agentId: "agent-c", visitedAt: 3 },
    { serverId: "s", workspaceId: "previous", agentId: null, visitedAt: 2 },
    { serverId: "s", workspaceId: "older", agentId: "agent-o", visitedAt: 1 },
  ],
};

vi.mock("@/stores/navigation-active-workspace-store", () => ({
  navigateToWorkspace: (input: unknown) => navigateToWorkspace(input),
}));
vi.mock("@/stores/recent-visits-store", () => ({
  useRecentVisitsStore: { getState: () => recentState },
}));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: { getState: () => ({ sessions: {} }) },
}));
vi.mock("@/stores/session-store-hooks/selectors", () => ({
  selectWorkspace: (_state: unknown, serverId: string, workspaceId: string) => ({
    id: workspaceId,
    name: `${serverId}/${workspaceId}`,
    title: null,
    projectDisplayName: "paseo",
    archivingAt: null,
  }),
}));

import {
  handleRecentWorkspaceSwitcherKeyDown,
  handleRecentWorkspaceSwitcherKeyUp,
  closeRecentWorkspaceSwitcher,
  openRecentWorkspaceSwitcher,
  useRecentWorkspaceSwitcherStore,
} from "./recent-workspace-switcher-store";

const current = { serverId: "s", workspaceId: "current" };

describe("recent workspace switcher", () => {
  beforeEach(() => {
    navigateToWorkspace.mockClear();
    closeRecentWorkspaceSwitcher();
  });

  it("switches to the previous workspace on a quick Ctrl+Tab tap", () => {
    expect(openRecentWorkspaceSwitcher({ direction: 1, current, hold: true })).toBe(true);
    expect(useRecentWorkspaceSwitcherStore.getState()).toMatchObject({ open: true, index: 1 });

    expect(handleRecentWorkspaceSwitcherKeyUp({ key: "Control" })).toBe(true);

    expect(navigateToWorkspace).toHaveBeenCalledWith({ serverId: "s", workspaceId: "previous" });
    expect(useRecentWorkspaceSwitcherStore.getState().open).toBe(false);
  });

  it("cycles with Tab and Shift+Tab while Control is held", () => {
    openRecentWorkspaceSwitcher({ direction: 1, current, hold: true });
    handleRecentWorkspaceSwitcherKeyDown({ key: "Tab", shiftKey: false, ctrlKey: true });
    expect(useRecentWorkspaceSwitcherStore.getState().index).toBe(2);
    handleRecentWorkspaceSwitcherKeyDown({ key: "Tab", shiftKey: false, ctrlKey: true });
    expect(useRecentWorkspaceSwitcherStore.getState().index).toBe(0);
    handleRecentWorkspaceSwitcherKeyDown({ key: "Tab", shiftKey: true, ctrlKey: true });

    handleRecentWorkspaceSwitcherKeyUp({ key: "Control" });

    expect(navigateToWorkspace).toHaveBeenCalledWith({ serverId: "s", workspaceId: "older" });
  });

  it("stays put when the highlighted row is the current workspace", () => {
    openRecentWorkspaceSwitcher({ direction: 1, current, hold: true });
    handleRecentWorkspaceSwitcherKeyDown({ key: "ArrowUp", shiftKey: false, ctrlKey: true });

    handleRecentWorkspaceSwitcherKeyUp({ key: "Control" });

    expect(navigateToWorkspace).not.toHaveBeenCalled();
  });

  it("cancels on Escape and lets unrelated keys through after closing", () => {
    openRecentWorkspaceSwitcher({ direction: 1, current, hold: true });
    expect(
      handleRecentWorkspaceSwitcherKeyDown({ key: "Escape", shiftKey: false, ctrlKey: true }),
    ).toBe(true);
    expect(handleRecentWorkspaceSwitcherKeyUp({ key: "Control" })).toBe(false);

    openRecentWorkspaceSwitcher({ direction: 1, current, hold: true });
    expect(handleRecentWorkspaceSwitcherKeyDown({ key: "a", shiftKey: false, ctrlKey: true })).toBe(
      false,
    );
    expect(useRecentWorkspaceSwitcherStore.getState().open).toBe(false);
    expect(navigateToWorkspace).not.toHaveBeenCalled();
  });

  it("finishes the switch when a key arrives after Control was released unseen", () => {
    openRecentWorkspaceSwitcher({ direction: 1, current, hold: true });

    expect(
      handleRecentWorkspaceSwitcherKeyDown({ key: "Tab", shiftKey: false, ctrlKey: false }),
    ).toBe(false);

    expect(useRecentWorkspaceSwitcherStore.getState().open).toBe(false);
    expect(navigateToWorkspace).toHaveBeenCalledWith({ serverId: "s", workspaceId: "previous" });
  });

  it("switches immediately when it cannot see Control being released", () => {
    expect(openRecentWorkspaceSwitcher({ direction: 1, current, hold: false })).toBe(true);
    expect(useRecentWorkspaceSwitcherStore.getState().open).toBe(false);
    expect(navigateToWorkspace).toHaveBeenCalledWith({ serverId: "s", workspaceId: "previous" });
  });

  it("does nothing when there is no other workspace to go to", () => {
    const saved = recentState.visits;
    recentState.visits = [saved[0]!];
    try {
      expect(openRecentWorkspaceSwitcher({ direction: 1, current, hold: true })).toBe(false);
      expect(useRecentWorkspaceSwitcherStore.getState().open).toBe(false);
    } finally {
      recentState.visits = saved;
    }
  });
});
