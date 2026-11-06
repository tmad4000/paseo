import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));

import { usePanelStore } from "@/stores/panel-store";
import {
  collectAllTabs,
  findPaneById,
  selectExplorerSidebarPaneId,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import {
  isExplorerSidebarOpen,
  openExplorerSidebarView,
  resolveExplorerSidebarPresentation,
  toggleExplorerSidebar,
} from "@/workspace-tabs/explorer-sidebar";

const WORKSPACE_KEY = "server-1:ws-main";
const CHECKOUT = { serverId: "server-1", cwd: "/tmp/repo", isGit: true };

beforeEach(() => {
  useWorkspaceLayoutStore.setState({
    layoutByWorkspace: {},
    explorerSidebarPaneIdByWorkspace: {},
    sidePaneIdByWorkspace: {},
    splitSizesByWorkspace: {},
  });
  usePanelStore.setState({
    mobilePanel: { target: "agent", revision: 0 },
    explorerTab: "files",
    explorerTabByCheckout: {},
  });
});

describe("Explorer sidebar", () => {
  it("selects the Explorer shell from layout and split capabilities", () => {
    expect(resolveExplorerSidebarPresentation({ isCompact: true })).toBe("overlay");
    expect(
      resolveExplorerSidebarPresentation({ isCompact: false, supportsPaneSplits: false }),
    ).toBe("dock");
    expect(resolveExplorerSidebarPresentation({ isCompact: false, supportsPaneSplits: true })).toBe(
      "pane",
    );
  });

  it("uses the compact explorer without creating a desktop pane", () => {
    openExplorerSidebarView({
      isCompact: true,
      workspaceKey: WORKSPACE_KEY,
      checkout: CHECKOUT,
      view: "changes",
    });

    expect(usePanelStore.getState().mobilePanel.target).toBe("file-explorer");
    expect(useWorkspaceLayoutStore.getState().layoutByWorkspace[WORKSPACE_KEY]).toBeUndefined();
  });

  it("creates a dedicated desktop Explorer containing only its requested tree", () => {
    openExplorerSidebarView({
      isCompact: false,
      supportsPaneSplits: true,
      workspaceKey: WORKSPACE_KEY,
      checkout: CHECKOUT,
      view: "files",
    });

    const state = useWorkspaceLayoutStore.getState();
    const layout = state.layoutByWorkspace[WORKSPACE_KEY];
    const paneId = selectExplorerSidebarPaneId(state, WORKSPACE_KEY);
    expect(paneId).not.toBeNull();
    expect(layout && collectAllTabs(layout.root).map((tab) => tab.target.kind)).toContain("files");
  });

  it("toggles the desktop Explorer independently of ordinary panes", () => {
    const input = {
      isCompact: false,
      supportsPaneSplits: true,
      workspaceKey: WORKSPACE_KEY,
      checkout: CHECKOUT,
    };
    openExplorerSidebarView({ ...input, view: "files" });
    toggleExplorerSidebar(input);
    expect(isExplorerSidebarOpen(input)).toBe(false);
    toggleExplorerSidebar(input);
    expect(isExplorerSidebarOpen(input)).toBe(true);
    const openedState = useWorkspaceLayoutStore.getState();
    const openedLayout = openedState.layoutByWorkspace[WORKSPACE_KEY];
    const explorerPaneId = selectExplorerSidebarPaneId(openedState, WORKSPACE_KEY);
    const explorerPane =
      openedLayout && explorerPaneId ? findPaneById(openedLayout.root, explorerPaneId) : null;
    const activeExplorerTarget =
      openedLayout && explorerPane
        ? collectAllTabs(openedLayout.root).find((tab) => tab.tabId === explorerPane.focusedTabId)
            ?.target.kind
        : null;
    expect(activeExplorerTarget).toBe("files");
  });

  it("toggles the compact Explorer without changing its selected view", () => {
    usePanelStore.getState().setExplorerTabForCheckout({ ...CHECKOUT, tab: "files" });
    const input = {
      isCompact: true,
      workspaceKey: WORKSPACE_KEY,
      checkout: CHECKOUT,
    };

    toggleExplorerSidebar(input);

    expect(isExplorerSidebarOpen(input)).toBe(true);
    expect(usePanelStore.getState().explorerTab).toBe("files");
  });
});

import { resolveSearchPresentedPane, selectWorkspaceSearchTab } from "./search-selection";
import { deriveWorkspacePaneState } from "@/screens/workspace/workspace-pane-state";
import { selectVisibleAgentIds } from "@/screens/workspace/visible-agent-ids";

describe("workspace search reveals existing Explorer content", () => {
  for (const target of [
    { kind: "agent", agentId: "explorer-agent" } as const,
    { kind: "terminal", terminalId: "explorer-terminal" } as const,
  ]) {
    it(`presents an Explorer ${target.kind} on compact without moving it or stealing saved main focus`, () => {
      const store = useWorkspaceLayoutStore.getState();
      const mainId = store.openTab({
        workspaceKey: WORKSPACE_KEY,
        intent: "reveal",
        target: { kind: "agent", agentId: "main-agent" },
      });
      const explorerId = store.showExplorerSidebar(WORKSPACE_KEY)!;
      const tabId = store.openTab({
        workspaceKey: WORKSPACE_KEY,
        intent: "reveal",
        target,
        placement: { mode: "pane", paneId: explorerId },
      })!;
      store.hideExplorerSidebar(WORKSPACE_KEY);
      const before = useWorkspaceLayoutStore.getState().layoutByWorkspace[WORKSPACE_KEY];
      const selection = selectWorkspaceSearchTab({
        workspaceKey: WORKSPACE_KEY,
        tabId,
        singlePane: true,
        isCompact: true,
        checkout: CHECKOUT,
      });
      const layout = useWorkspaceLayoutStore.getState().layoutByWorkspace[WORKSPACE_KEY];
      expect(layout.focusedPaneId).toBe(before.focusedPaneId);
      expect(findPaneById(layout.root, layout.focusedPaneId!)?.focusedTabId).toBe(mainId);
      expect(findPaneById(layout.root, explorerId)?.tabIds).toContain(tabId);
      expect(findPaneById(layout.root, explorerId)?.hidden).not.toBe(true);
      expect(collectAllTabs(layout.root).map((tab) => tab.tabId)).toEqual(
        collectAllTabs(before.root).map((tab) => tab.tabId),
      );
      expect(
        resolveSearchPresentedPane({
          selection,
          workspaceKey: WORKSPACE_KEY,
          layout,
          singlePane: true,
        }),
      ).toBe(explorerId);
      expect(
        deriveWorkspacePaneState({ layout, tabs: collectAllTabs(layout.root), paneId: explorerId })
          .activeTabId,
      ).toBe(tabId);
      expect(
        resolveSearchPresentedPane({
          selection,
          workspaceKey: WORKSPACE_KEY,
          layout,
          singlePane: false,
        }),
      ).toBe(layout.focusedPaneId);
      if (target.kind === "agent")
        expect(
          selectVisibleAgentIds({
            layout,
            tabs: collectAllTabs(layout.root),
            routeFocused: true,
            focusedPaneOnly: true,
            presentedPaneId: explorerId,
          }),
        ).toEqual([target.agentId]);
      store.closeTab(WORKSPACE_KEY, tabId);
      expect(
        selectWorkspaceSearchTab({
          workspaceKey: WORKSPACE_KEY,
          tabId,
          singlePane: true,
          isCompact: true,
          checkout: CHECKOUT,
        }),
      ).toBeNull();
      const closedLayout = useWorkspaceLayoutStore.getState().layoutByWorkspace[WORKSPACE_KEY];
      expect(collectAllTabs(closedLayout.root).some((tab) => tab.tabId === tabId)).toBe(false);
      expect(
        resolveSearchPresentedPane({
          selection,
          workspaceKey: WORKSPACE_KEY,
          layout: closedLayout,
          singlePane: true,
        }),
      ).toBe(closedLayout.focusedPaneId);
    });
  }
});

it("search leaves desktop focus mode to reveal an existing Explorer tab", () => {
  const store = useWorkspaceLayoutStore.getState();
  store.openTab({
    workspaceKey: WORKSPACE_KEY,
    intent: "reveal",
    target: { kind: "agent", agentId: "main" },
  });
  const paneId = store.showExplorerSidebar(WORKSPACE_KEY)!;
  const tabId = store.openTab({
    workspaceKey: WORKSPACE_KEY,
    intent: "reveal",
    target: { kind: "agent", agentId: "explorer" },
    placement: { mode: "pane", paneId },
  })!;
  store.hideExplorerSidebar(WORKSPACE_KEY);
  usePanelStore.getState().toggleFocusMode();
  selectWorkspaceSearchTab({
    workspaceKey: WORKSPACE_KEY,
    tabId,
    singlePane: false,
    isCompact: false,
    checkout: CHECKOUT,
  });
  expect(usePanelStore.getState().desktop.focusModeEnabled).toBe(false);
  expect(
    findPaneById(useWorkspaceLayoutStore.getState().layoutByWorkspace[WORKSPACE_KEY].root, paneId)
      ?.hidden,
  ).not.toBe(true);
});

it("search keeps Files in the established compact Explorer overlay", () => {
  const store = useWorkspaceLayoutStore.getState();
  store.openTab({
    workspaceKey: WORKSPACE_KEY,
    intent: "reveal",
    target: { kind: "agent", agentId: "main" },
  });
  const paneId = store.showExplorerSidebar(WORKSPACE_KEY)!;
  const tabId = store.openTab({
    workspaceKey: WORKSPACE_KEY,
    intent: "reveal",
    target: { kind: "files" },
    placement: { mode: "pane", paneId },
  })!;
  const mainPaneId =
    useWorkspaceLayoutStore.getState().layoutByWorkspace[WORKSPACE_KEY].focusedPaneId;
  expect(
    selectWorkspaceSearchTab({
      workspaceKey: WORKSPACE_KEY,
      tabId,
      singlePane: true,
      isCompact: true,
      checkout: CHECKOUT,
    }),
  ).toBeNull();
  expect(usePanelStore.getState().mobilePanel.target).toBe("file-explorer");
  expect(useWorkspaceLayoutStore.getState().layoutByWorkspace[WORKSPACE_KEY].focusedPaneId).toBe(
    mainPaneId,
  );
});
