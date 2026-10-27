import { expect, test, type Page } from "../support/fixtures";
import { createMockIdleAgent, openWorkspaceWithAgents } from "../support/helpers/archive-tab";
import { seedWorkspace } from "../support/helpers/seed-client";

function agentTab(page: Page, agentId: string) {
  return page.getByTestId(`workspace-tab-agent_${agentId}`).filter({ visible: true }).first();
}

test.describe.configure({ timeout: 120_000 });

const visibleControl = (page: Page, testID: string) =>
  page.getByTestId(testID).filter({ visible: true }).first();

test("visible history dropdown reaches older sessions and preserves Back/Forward order", async ({
  page,
}, testInfo) => {
  const workspace = await seedWorkspace({ repoPrefix: "navigation-history-dropdown-" });
  try {
    await page.setViewportSize({ width: 1400, height: 900 });
    const first = await createMockIdleAgent(workspace.client, {
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Earlier session",
    });
    const second = await createMockIdleAgent(workspace.client, {
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Later session",
    });
    await openWorkspaceWithAgents(page, [first, second]);

    // More than the former 15-row menu limit, without creating extra agents.
    for (let visit = 0; visit < 18; visit += 1) {
      const agent = visit % 2 === 0 ? first : second;
      await agentTab(page, agent.id).click({ position: { x: 12, y: 13 } });
      await expect(agentTab(page, agent.id)).toHaveAttribute("aria-selected", "true");
    }

    const trigger = visibleControl(page, "navigation-back-button-history-menu-button");
    await trigger.focus();
    await page.keyboard.press("Enter");
    const menu = visibleControl(page, "navigation-back-button-history");
    await expect(menu).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await page.screenshot({ path: testInfo.outputPath("history-desktop.png") });
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();
    const olderEntry = menu.getByTestId("navigation-back-history-item-16");
    await expect(olderEntry).toContainText(first.title);
    await olderEntry.click();
    await expect(menu).toBeHidden();
    await expect(agentTab(page, first.id)).toHaveAttribute("aria-selected", "true");

    await visibleControl(page, "navigation-forward-button").click();
    await expect(agentTab(page, second.id)).toHaveAttribute("aria-selected", "true");
    await visibleControl(page, "navigation-back-button").click();
    await expect(agentTab(page, first.id)).toHaveAttribute("aria-selected", "true");

    // The same explicit dropdown is available by touch on a compact layout.
    await page.setViewportSize({ width: 390, height: 844 });
    await visibleControl(page, "navigation-back-button-history-menu-button").click();
    const compactMenu = visibleControl(page, "navigation-back-button-history-content");
    await expect(compactMenu).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("history-compact.png") });
    await compactMenu.getByRole("menuitem").filter({ hasText: second.title }).first().click();
    await expect(compactMenu).toBeHidden();

    await page.setViewportSize({ width: 1400, height: 900 });
    await expect(agentTab(page, second.id)).toHaveAttribute("aria-selected", "true");
    // Browsers reserve Ctrl+Tab; the browser-supported fallback cycles the app's tabs.
    await page.keyboard.press("Alt+Shift+[");
    await expect(agentTab(page, first.id)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Alt+Shift+]");
    await expect(agentTab(page, second.id)).toHaveAttribute("aria-selected", "true");
  } finally {
    await workspace.cleanup();
  }
});
