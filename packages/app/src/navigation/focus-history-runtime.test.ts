import { describe, expect, it, vi } from "vitest";

vi.mock("expo-router", () => ({
  router: { navigate: vi.fn() },
  usePathname: () => "/",
}));

import { createDefaultLayout } from "@/stores/workspace-layout-store";
import {
  FOCUSED_PANE_PLACEMENT,
  collectAllTabs,
  createTabInLayout,
  findPaneById,
  focusTabInLayout,
  openTabInLayoutFocused,
  revealTargetInLayout,
} from "@/stores/workspace-layout-actions";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store/navigation";
import type { Agent, WorkspaceDescriptor } from "@/stores/session-store";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import {
  buildWorkspaceFocusLocation,
  createGestureDeduper,
  focusHistoryDirectionForMouseButton,
  parseDesktopNavigationDirection,
  restoreNavigationFocusLocation,
  type RestoreNavigationFocusLocationDeps,
} from "./focus-history-runtime";

function makeDeps(): RestoreNavigationFocusLocationDeps {
  return {
    navigateWorkspace: vi.fn(() => "/h/server-1/workspace/workspace-a"),
    navigateRoute: vi.fn(),
    focusPane: vi.fn(),
    focusTab: vi.fn(),
    restoreView: vi.fn(),
  };
}

describe("workspace focus locations", () => {
  it("captures the focused pane, tab target, and view", () => {
    const opened = openTabInLayoutFocused({
      layout: createDefaultLayout(),
      target: { kind: "agent", agentId: "agent-a" },
      now: 1,
      placement: FOCUSED_PANE_PLACEMENT,
      explorerSidebarPaneId: null,
    });
    if (!opened) throw new Error("expected the tab to open");

    expect(
      buildWorkspaceFocusLocation({
        serverId: "server-1",
        workspaceId: "workspace-a",
        layout: opened.layout,
        view: { panel: "file-explorer", explorerTab: "files" },
      }),
    ).toEqual({
      kind: "workspace",
      serverId: "server-1",
      workspaceId: "workspace-a",
      paneId: "main",
      tabId: "agent_agent-a",
      target: { kind: "agent", agentId: "agent-a" },
      view: { panel: "file-explorer", explorerTab: "files" },
    });
  });

  it("restores workspace routing before exact tab and panel focus", () => {
    const deps = makeDeps();
    restoreNavigationFocusLocation(
      {
        kind: "workspace",
        serverId: "server-1",
        workspaceId: "workspace-a",
        paneId: "pane-side",
        tabId: "agent_agent-a",
        target: { kind: "agent", agentId: "agent-a" },
        view: { panel: "agent", explorerTab: "changes" },
      },
      deps,
    );

    expect(deps.navigateWorkspace).toHaveBeenCalledWith({
      serverId: "server-1",
      workspaceId: "workspace-a",
      target: { kind: "agent", agentId: "agent-a" },
    });
    expect(deps.focusTab).toHaveBeenCalledWith("server-1:workspace-a", "agent_agent-a");
    expect(deps.focusPane).not.toHaveBeenCalled();
    expect(deps.restoreView).toHaveBeenCalledWith({ panel: "agent", explorerTab: "changes" });
  });

  it("restores an existing empty tab by its instance without reopening its target", () => {
    const draft = createTabInLayout({
      layout: createDefaultLayout(),
      target: { kind: "draft", draftId: "draft-a" },
      now: 1,
      placement: FOCUSED_PANE_PLACEMENT,
      explorerSidebarPaneId: null,
      createTabId: () => "draft-a",
    });
    if (!draft) throw new Error("expected draft tab");
    const empty = createTabInLayout({
      layout: draft.layout,
      target: { kind: "new_tab" },
      now: 2,
      placement: FOCUSED_PANE_PLACEMENT,
      explorerSidebarPaneId: null,
      createTabId: () => "empty-a",
    });
    if (!empty) throw new Error("expected empty tab");
    const location = buildWorkspaceFocusLocation({
      serverId: "server-1",
      workspaceId: "workspace-a",
      layout: empty.layout,
      view: { panel: "agent", explorerTab: "changes" },
    });
    let layout = focusTabInLayout({ layout: empty.layout, tabId: "draft-a" }) ?? empty.layout;
    expect(findPaneById(layout.root, "main")?.focusedTabId).toBe("draft-a");
    const navigateRoute = vi.fn();
    const openedTargets: WorkspaceTabTarget[] = [];
    const workspace: WorkspaceDescriptor = {
      id: "workspace-a",
      projectId: "project-a",
      projectDisplayName: "Project",
      projectRootPath: "/repo",
      workspaceDirectory: "/repo",
      projectKind: "git",
      workspaceKind: "local_checkout",
      name: "main",
      status: "attention",
      statusEnteredAt: null,
      archivingAt: null,
      diffStat: null,
      scripts: [],
    };
    const attentionAgent: Agent = {
      serverId: "server-1",
      id: "agent-attention",
      provider: "codex",
      status: "idle",
      turn: { phase: "idle", cancellationRequestId: null },
      createdAt: new Date(0),
      updatedAt: new Date(0),
      lastUserMessageAt: null,
      lastActivityAt: new Date(0),
      capabilities: {
        supportsStreaming: true,
        supportsSessionPersistence: true,
        supportsDynamicModes: true,
        supportsMcpServers: true,
        supportsReasoningStream: true,
        supportsToolInvocations: true,
      },
      currentModeId: null,
      availableModes: [],
      pendingPermissions: [],
      persistence: null,
      title: "Attention session",
      cwd: "/repo",
      workspaceId: "workspace-a",
      model: null,
      parentAgentId: null,
      labels: {},
      requiresAttention: true,
      attentionReason: "finished",
    };
    const deps: RestoreNavigationFocusLocationDeps = {
      navigateWorkspace: (input) =>
        navigateToWorkspace(input, {
          getSessionWorkspaces: () => new Map([[workspace.id, workspace]]),
          getSessionAgents: () => [attentionAgent],
          isWorkspaceLayoutHydrated: () => true,
          rememberLastWorkspace: vi.fn(),
          navigateToRoute: navigateRoute,
          openTab: (open) => {
            openedTargets.push(open.target);
            const result = revealTargetInLayout({
              layout,
              target: open.target,
              now: 3,
              placement: FOCUSED_PANE_PLACEMENT,
              explorerSidebarPaneId: null,
              createTabId: () => "unexpected-new-tab",
            });
            if (result) layout = result.layout;
            return result?.tabId ?? null;
          },
        }),
      navigateRoute: vi.fn(),
      focusPane: vi.fn(),
      focusTab: (_key, tabId) => {
        layout = focusTabInLayout({ layout, tabId }) ?? layout;
      },
      restoreView: vi.fn(),
    };

    expect(() => restoreNavigationFocusLocation(location, deps)).not.toThrow();
    expect(findPaneById(layout.root, "main")?.focusedTabId).toBe("empty-a");
    expect(openedTargets).toEqual([]);
    expect(collectAllTabs(layout.root).map((tab) => tab.tabId)).toEqual(["draft-a", "empty-a"]);
    expect(navigateRoute).toHaveBeenCalledWith("/h/server-1/workspace/workspace-a");
  });

  it("restores non-workspace routes without changing workspace state", () => {
    const deps = makeDeps();

    restoreNavigationFocusLocation({ kind: "route", pathname: "/settings/general" }, deps);

    expect(deps.navigateRoute).toHaveBeenCalledWith("/settings/general");
    expect(deps.navigateWorkspace).not.toHaveBeenCalled();
    expect(deps.restoreView).not.toHaveBeenCalled();
  });
});

describe("navigation gestures", () => {
  it("maps mouse side buttons to Back and Forward", () => {
    expect(focusHistoryDirectionForMouseButton(3)).toBe("back");
    expect(focusHistoryDirectionForMouseButton(4)).toBe("forward");
    expect(focusHistoryDirectionForMouseButton(0)).toBeNull();
    expect(focusHistoryDirectionForMouseButton(2)).toBeNull();
  });

  it("accepts only well-formed desktop navigation payloads", () => {
    expect(parseDesktopNavigationDirection({ direction: "back" })).toBe("back");
    expect(parseDesktopNavigationDirection({ direction: "forward" })).toBe("forward");
    expect(parseDesktopNavigationDirection({ direction: "up" })).toBeNull();
    expect(parseDesktopNavigationDirection("back")).toBeNull();
    expect(parseDesktopNavigationDirection(null)).toBeNull();
  });

  it("acts once when one press arrives as both a mouse event and an app command", () => {
    let now = 1_000;
    const accept = createGestureDeduper(() => now);

    expect(accept("back")).toBe(true);
    now += 20;
    expect(accept("back")).toBe(false);
    expect(accept("forward")).toBe(true);
    now += 400;
    expect(accept("forward")).toBe(true);
  });
});
