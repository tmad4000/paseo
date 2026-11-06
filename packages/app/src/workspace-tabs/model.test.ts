import { describe, expect, it } from "vitest";
import { buildWorkspaceTabPersistenceKey } from "./model";

describe("buildWorkspaceTabPersistenceKey", () => {
  it("trims and joins opaque server and workspace ids", () => {
    expect(
      buildWorkspaceTabPersistenceKey({
        serverId: "  server-1  ",
        workspaceId: "  setup\\workspace\\  ",
      }),
    ).toBe("server-1:setup\\workspace\\");
  });

  it("rejects incomplete identities", () => {
    expect(buildWorkspaceTabPersistenceKey({ serverId: "", workspaceId: "workspace" })).toBeNull();
    expect(buildWorkspaceTabPersistenceKey({ serverId: "server", workspaceId: "  " })).toBeNull();
  });
});

// Search walks the persisted tree, rather than the currently rendered/focused pane.
import { collectWorkspaceTabSearchEntries } from "./search";
import type { WorkspaceTab, WorkspaceTabTarget } from "./model";
import type { SplitNode, WorkspaceLayout } from "@/stores/workspace-layout-actions";

function searchPane(id: string, targets: WorkspaceTabTarget[], hidden = false): SplitNode {
  const tabs: WorkspaceTab[] = targets.map((target, index) => ({
    tabId: `${id}-${index}`,
    target,
    createdAt: index,
  }));
  return {
    kind: "pane",
    pane: {
      id,
      tabIds: tabs.map((tab) => tab.tabId),
      focusedTabId: tabs[0]?.tabId ?? null,
      hidden,
      tabs,
    },
  } as SplitNode;
}

it("search includes every tab kind in pane/tab order, including hidden Explorer and covered splits", () => {
  const targets: WorkspaceTabTarget[] = [
    { kind: "agent", agentId: "real-title" },
    { kind: "provider_subagent", parentAgentId: "parent", subagentId: "child" },
    { kind: "terminal", terminalId: "named" },
    { kind: "browser", browserId: "page-title" },
    { kind: "file", path: "src/search.ts" },
    { kind: "working_diff", focusPath: "src/search.ts" },
    { kind: "commit_diff", sha: "abcdef" },
    { kind: "draft", draftId: "draft" },
    { kind: "setup", workspaceId: "workspace" },
    { kind: "plugin", pluginId: "fixture", panelId: "actual-label", context: "workspace" },
    { kind: "new_tab" },
  ];
  const layout: WorkspaceLayout = {
    focusedPaneId: "right",
    root: {
      kind: "group",
      group: {
        id: "root",
        direction: "horizontal",
        sizes: [0.4, 0.4, 0.2],
        children: [
          searchPane("left", targets),
          searchPane("right", []),
          searchPane(
            "explorer",
            [{ kind: "files" }, { kind: "changes_tree" }, { kind: "pull_request" }],
            true,
          ),
        ],
      },
    },
  };
  const before = JSON.stringify(layout);
  const entries = collectWorkspaceTabSearchEntries(layout, "explorer");
  expect(entries.map((entry) => entry.tab.target)).toEqual([
    ...targets,
    { kind: "files" },
    { kind: "changes_tree" },
    { kind: "pull_request" },
  ]);
  expect(entries.slice(-3).every((entry) => entry.hidden && entry.explorer)).toBe(true);
  expect(entries[0].paneId).toBe("left");
  expect(entries[0].paneTabIds).toHaveLength(targets.length);
  expect(JSON.stringify(layout)).toBe(before);
  expect(collectWorkspaceTabSearchEntries(null, null)).toEqual([]);
});
