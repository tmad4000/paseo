// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useWorkspaceLayoutStore, type WorkspaceLayout } from "@/stores/workspace-layout-store";
import { useWorkspaceTabSearchSelection } from "./search-selection";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));

const workspaceKey = "search-selection-host:workspace";
const checkout = { serverId: "search-selection-host", cwd: "/fixture", isGit: false };
const currentLayout = () => useWorkspaceLayoutStore.getState().layoutByWorkspace[workspaceKey];

beforeEach(() => {
  useWorkspaceLayoutStore.setState({ layoutByWorkspace: {}, explorerSidebarPaneIdByWorkspace: {} });
});

it("discards temporary Explorer presentation after main navigation, including returning to its original tab", () => {
  const store = useWorkspaceLayoutStore.getState();
  const original = store.openTab({
    workspaceKey,
    intent: "reveal",
    target: { kind: "agent", agentId: "original" },
  })!;
  const other = store.openTab({
    workspaceKey,
    intent: "background",
    target: { kind: "agent", agentId: "other" },
  })!;
  const explorer = store.showExplorerSidebar(workspaceKey)!;
  const guest = store.openTab({
    workspaceKey,
    intent: "reveal",
    target: { kind: "agent", agentId: "guest" },
    placement: { mode: "pane", paneId: explorer },
  })!;
  store.hideExplorerSidebar(workspaceKey);
  store.focusTab(workspaceKey, original);
  const mainPane = currentLayout().focusedPaneId;
  const { result, rerender } = renderHook(
    ({ layout }: { layout: WorkspaceLayout }) =>
      useWorkspaceTabSearchSelection({
        workspaceKey,
        layout,
        isCompact: true,
        checkout,
        enabled: true,
      }),
    { initialProps: { layout: currentLayout() } },
  );

  act(() => {
    result.current.onSelect(guest);
    rerender({ layout: currentLayout() });
  });
  expect(result.current.presentedPaneId).toBe(explorer);
  // Navigation outside the picker updates durable main focus directly.
  act(() => {
    store.focusTab(workspaceKey, other);
    rerender({ layout: currentLayout() });
  });
  expect(result.current.presentedPaneId).toBe(mainPane);
  act(() => {
    store.focusTab(workspaceKey, original);
    rerender({ layout: currentLayout() });
  });
  expect(result.current.presentedPaneId).toBe(mainPane);
});
