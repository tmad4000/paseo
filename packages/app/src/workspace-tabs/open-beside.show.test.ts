import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));

import {
  collectAllPanes,
  findPaneById,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import { showWorkspaceTargetBeside } from "@/workspace-tabs/open-beside";

const WORKSPACE_KEY = "server-1:workspace-1";

beforeEach(() => {
  useWorkspaceLayoutStore.setState({
    layoutByWorkspace: {},
    explorerSidebarPaneIdByWorkspace: {},
    sidePaneIdByWorkspace: {},
    splitSizesByWorkspace: {},
  });
  useWorkspaceLayoutStore.getState().openTab({
    workspaceKey: WORKSPACE_KEY,
    target: { kind: "agent", agentId: "parent" },
    intent: "reveal",
  });
});

function layout() {
  const value = useWorkspaceLayoutStore.getState().layoutByWorkspace[WORKSPACE_KEY];
  if (!value) throw new Error("no layout");
  return value;
}

describe("showWorkspaceTargetBeside", () => {
  it("shows the target in a side pane and leaves the focused pane alone", () => {
    const focusedBefore = layout().focusedPaneId;
    const tabId = showWorkspaceTargetBeside({
      workspaceKey: WORKSPACE_KEY,
      target: { kind: "file", path: "CHECKLIST.md" },
      isCompact: false,
    });
    expect(tabId).toBeTruthy();
    const panes = collectAllPanes(layout().root);
    expect(panes).toHaveLength(2);
    expect(layout().focusedPaneId).toBe(focusedBefore);
    const side = panes.find((pane) => pane.id !== focusedBefore);
    expect(side?.focusedTabId).toBe(tabId);
    expect(findPaneById(layout().root, focusedBefore)?.tabIds).toHaveLength(1);
  });

  it("reuses the side pane and its tab when the same target is shown again", () => {
    const first = showWorkspaceTargetBeside({
      workspaceKey: WORKSPACE_KEY,
      target: { kind: "file", path: "CHECKLIST.md" },
      isCompact: false,
    });
    showWorkspaceTargetBeside({
      workspaceKey: WORKSPACE_KEY,
      target: { kind: "file", path: "OTHER.md" },
      isCompact: false,
    });
    const again = showWorkspaceTargetBeside({
      workspaceKey: WORKSPACE_KEY,
      target: { kind: "file", path: "CHECKLIST.md" },
      isCompact: false,
    });
    expect(again).toBe(first);
    expect(collectAllPanes(layout().root)).toHaveLength(2);
    const side = collectAllPanes(layout().root).find((pane) => pane.tabIds.includes(first ?? ""));
    expect(side?.focusedTabId).toBe(first);
  });

  it("keeps the tab in the background on compact layouts", () => {
    const focusedBefore = layout().focusedPaneId;
    showWorkspaceTargetBeside({
      workspaceKey: WORKSPACE_KEY,
      target: { kind: "file", path: "CHECKLIST.md" },
      isCompact: true,
    });
    expect(collectAllPanes(layout().root)).toHaveLength(1);
    expect(layout().focusedPaneId).toBe(focusedBefore);
    expect(findPaneById(layout().root, focusedBefore)?.tabIds).toHaveLength(2);
  });

  it("does not change the main pane's visible tab when the target already lives there", () => {
    const store = useWorkspaceLayoutStore.getState();
    const mainTab = store.openTab({
      workspaceKey: WORKSPACE_KEY,
      target: { kind: "file", path: "CHECKLIST.md" },
      intent: "background",
    });
    const mainPaneId = layout().focusedPaneId;
    const visibleBefore = findPaneById(layout().root, mainPaneId)?.focusedTabId;
    expect(visibleBefore).not.toBe(mainTab);
    const shown = showWorkspaceTargetBeside({
      workspaceKey: WORKSPACE_KEY,
      target: { kind: "file", path: "CHECKLIST.md" },
      isCompact: false,
    });
    expect(shown).toBe(mainTab);
    expect(findPaneById(layout().root, mainPaneId)?.focusedTabId).toBe(visibleBefore);
    expect(layout().focusedPaneId).toBe(mainPaneId);
  });
});
