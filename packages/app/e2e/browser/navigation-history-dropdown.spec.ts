import { expect, test, type Page } from "../support/fixtures";
import { createMockIdleAgent, openWorkspaceWithAgents } from "../support/helpers/archive-tab";
import { seedWorkspace } from "../support/helpers/seed-client";
import { gotoWorkspace } from "../support/helpers/launcher";
import { parseStoredFocusHistory } from "../../src/navigation/focus-history-storage";

function agentTab(page: Page, agentId: string) {
  return page.getByTestId(`workspace-tab-agent_${agentId}`).filter({ visible: true }).first();
}

test.describe.configure({ timeout: 120_000 });

const visibleControl = (page: Page, testID: string) =>
  page.getByTestId(testID).filter({ visible: true }).first();

test("Back and Forward survive renderer reload and cold startup", async ({ page }, testInfo) => {
  const workspace = await seedWorkspace({ repoPrefix: "persist-focus-history-" });
  try {
    await page.setViewportSize({ width: 1400, height: 900 });
    const first = await createMockIdleAgent(workspace.client, {
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Earlier persisted session",
    });
    const second = await createMockIdleAgent(workspace.client, {
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Later persisted session",
    });
    await openWorkspaceWithAgents(page, [first, second]);
    for (const agent of [first, second]) {
      await agentTab(page, agent.id).click({ position: { x: 12, y: 13 } });
      await expect(agentTab(page, agent.id)).toHaveAttribute("aria-selected", "true");
    }
    await visibleControl(page, "navigation-back-button").click();
    await expect(agentTab(page, first.id)).toHaveAttribute("aria-selected", "true");
    await expect
      .poll(
        async () =>
          parseStoredFocusHistory(
            await page.evaluate(() => localStorage.getItem("paseo:focus-history")),
          )?.current,
      )
      .toMatchObject({ target: { kind: "agent", agentId: first.id } });

    await page.reload();
    await expect(agentTab(page, first.id)).toHaveAttribute("aria-selected", "true");
    await visibleControl(page, "navigation-forward-button").click();
    await expect(agentTab(page, second.id)).toHaveAttribute("aria-selected", "true");
    await expect
      .poll(
        async () =>
          parseStoredFocusHistory(
            await page.evaluate(() => localStorage.getItem("paseo:focus-history")),
          )?.current,
      )
      .toMatchObject({ target: { kind: "agent", agentId: second.id } });
    await page.goto("/");
    await expect(agentTab(page, second.id)).toHaveAttribute("aria-selected", "true");
    await visibleControl(page, "navigation-back-button").click();
    await expect(agentTab(page, first.id)).toHaveAttribute("aria-selected", "true");
    await page.screenshot({ path: testInfo.outputPath("restored-history.png") });
  } finally {
    await workspace.cleanup();
  }
});

for (const width of [1400, 390]) {
  test(`closing the final blank New tab leaves for Sessions without a warning at ${width}px`, async ({
    page,
  }, testInfo) => {
    const workspace = await seedWorkspace({ repoPrefix: "close-final-blank-", git: false });
    try {
      await page.setViewportSize({ width, height: 900 });
      await gotoWorkspace(page, workspace.workspaceId);
      await expect(
        page.getByTestId("workspace-new-tab-panel").filter({ visible: true }),
      ).toHaveCount(1);
      if (width < 600) {
        await page.getByTestId("workspace-tab-switcher-trigger").click();
        await page
          .locator('[data-testid^="workspace-tab-menu-tab_"][data-testid$="-trigger"]')
          .filter({ visible: true })
          .click();
        await page
          .locator('[data-testid^="workspace-tab-menu-tab_"][data-testid$="-close"]')
          .filter({ visible: true })
          .click();
      } else {
        await page.keyboard.press("Alt+Shift+w");
      }
      await expect(page).toHaveURL(/\/sessions(?:\?|$)/);
      await expect(page.getByRole("dialog").filter({ visible: true })).toHaveCount(0);
      await expect(
        page.getByText("Switch tab", { exact: true }).filter({ visible: true }),
      ).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath(`closed-blank-${width}.png`) });
    } finally {
      await workspace.cleanup();
    }
  });
}

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

    await visibleControl(page, "navigation-back-button").hover();
    await expect(menu).toBeVisible();
    const olderEntry = menu.getByTestId("navigation-back-history-item-16");
    await expect(olderEntry).toContainText(first.title);
    // Each row carries its workspace's open tab count, as the sidebar row does.
    await expect(menu.getByTestId("navigation-back-history-item-0-tab-count")).toHaveText("2");
    await page.screenshot({ path: testInfo.outputPath("history-tab-counts.png") });
    await olderEntry.click();
    await expect(menu).toBeHidden();
    await expect(agentTab(page, first.id)).toHaveAttribute("aria-selected", "true");

    const forwardMenu = visibleControl(page, "navigation-forward-button-history");
    await visibleControl(page, "navigation-forward-button").hover();
    await expect(forwardMenu).toBeVisible();
    await forwardMenu.getByTestId("navigation-forward-history-item-0").hover();
    await expect(forwardMenu).toBeVisible();
    // The preview never covers the one-step arrow or steals its click.
    await visibleControl(page, "navigation-forward-button").click();
    await expect(forwardMenu).toBeHidden();
    await expect(agentTab(page, second.id)).toHaveAttribute("aria-selected", "true");
    await visibleControl(page, "navigation-back-button").click();
    await expect(agentTab(page, first.id)).toHaveAttribute("aria-selected", "true");

    // The same explicit dropdown is available by touch on a compact layout.
    await page.setViewportSize({ width: 390, height: 844 });
    await visibleControl(page, "navigation-back-button-history-menu-button").click();
    const compactMenu = visibleControl(page, "navigation-back-button-history-content");
    await expect(compactMenu).toBeVisible();
    await expect(compactMenu.getByRole("menuitem").first()).toBeInViewport({ ratio: 1 });
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
