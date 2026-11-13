import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { openMobileAgentSidebar, selectSidebarStatusGrouping } from "../support/helpers/sidebar";

for (const grouping of ["project", "status"] as const) {
  test(`Pinned collapses workspace and session pins together in ${grouping} grouping`, async ({
    page,
  }) => {
    const workspace = await seedWorkspace({ repoPrefix: "pinned-collapse-" });
    try {
      const session = await workspace.client.createAgent({
        provider: "mock",
        modeId: "load-test",
        model: "ten-second-stream",
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: "Pinned session collapse",
      });
      await workspace.client.waitForAgentUpsert(session.id, (agent) => agent.status === "idle");
      await workspace.client.updateAgent(session.id, {
        labels: { "paseo.session-pinned-at": new Date().toISOString() },
      });
      await workspace.client.setWorkspacePinned(workspace.workspaceId, true);
      await gotoAppShell(page);
      if (grouping === "status") await selectSidebarStatusGrouping(page);

      const section = page.getByTestId("sidebar-pinned-section").filter({ visible: true });
      const header = section.getByTestId("sidebar-pinned-section-header");
      const workspacePin = section.getByTestId(
        `sidebar-workspace-row-${getServerId()}:${workspace.workspaceId}`,
      );
      const sessionPins = page.getByTestId("sidebar-pinned-sessions");
      const sessionPin = section.getByTestId(`sidebar-pinned-session-${session.id}`);

      await expect(workspacePin).toBeVisible();
      await expect(sessionPin).toBeVisible();
      await header.click();
      await expect(header).toHaveAttribute("aria-expanded", "false");
      await expect(workspacePin).toHaveCount(0);
      await expect(sessionPins).toHaveCount(0);
      await page.screenshot({ path: test.info().outputPath(`${grouping}-collapsed-desktop.png`) });

      await page.reload();
      await expect(header).toHaveAttribute("aria-expanded", "false");
      await expect(sessionPins).toHaveCount(0);
      await header.click();
      await expect(workspacePin).toBeVisible();
      await expect(sessionPin).toBeVisible();

      await page.setViewportSize({ width: 390, height: 844 });
      await openMobileAgentSidebar(page);
      await expect(sessionPin).toBeVisible();
      await header.click();
      await expect(header).toHaveAttribute("aria-expanded", "false");
      await expect(workspacePin).toHaveCount(0);
      await expect(sessionPins).toHaveCount(0);
      await page.screenshot({ path: test.info().outputPath(`${grouping}-collapsed-mobile.png`) });
      await header.click();
      await expect(sessionPin).toBeVisible();

      await workspace.client.setWorkspacePinned(workspace.workspaceId, false);
      await expect(workspacePin).toHaveCount(0);
      await expect(header).toBeVisible();
      await header.click();
      await expect(sessionPins).toHaveCount(0);
      await header.click();
      await expect(sessionPin).toBeVisible();
      await workspace.client.updateAgent(session.id, {
        labels: { "paseo.session-pinned-at": "" },
      });
      await expect(section).toHaveCount(0);
    } finally {
      await workspace.cleanup();
    }
  });
}
