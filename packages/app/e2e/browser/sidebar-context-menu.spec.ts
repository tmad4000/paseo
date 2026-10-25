import { test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { seedWorkspace } from "../support/helpers/seed-client";
import {
  closeProjectContextMenu,
  closeWorkspaceContextMenu,
  expectProjectContextMenuActions,
  expectWorkspaceContextMenuActions,
  expectWorkspaceContextMenuOwnsAttention,
  expectWorkspaceRowHoverCleared,
  openProjectContextMenu,
  openWorkspaceContextMenu,
  showWorkspaceHoverCard,
} from "../support/helpers/sidebar";

test.describe("Sidebar context menus", () => {
  for (const height of [720, 600]) {
    test(`right-clicking rows anchors their actions at the pointer in a ${height}px viewport`, async ({
      page,
    }) => {
      const workspace = await seedWorkspace({ repoPrefix: "sidebar-context-menu-" });

      try {
        await page.setViewportSize({ width: 1280, height });
        await gotoAppShell(page);

        await showWorkspaceHoverCard(page, workspace.workspaceId);
        await openWorkspaceContextMenu(page, workspace.workspaceId);
        await expectWorkspaceContextMenuActions(page, workspace.workspaceId);
        await expectWorkspaceContextMenuOwnsAttention(page);

        await closeWorkspaceContextMenu(page, workspace.workspaceId);
        await expectWorkspaceRowHoverCleared(page, workspace.workspaceId);
        await openProjectContextMenu(page, workspace.projectKey);
        await expectProjectContextMenuActions(page, workspace.projectKey);

        await closeProjectContextMenu(page, workspace.projectKey);
      } finally {
        await workspace.cleanup();
      }
    });
  }
});
