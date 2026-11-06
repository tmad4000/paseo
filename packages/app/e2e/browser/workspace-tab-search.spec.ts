import { test, expect } from "../support/fixtures";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

const composerName = "Message agent...";

for (const compact of [false, true]) {
  test(`workspace title search reveals another pane and preserves the draft (${compact ? "compact" : "desktop"})`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1400, height: 900 });
    const workspace = await seedMockAgentWorkspace({
      repoPrefix: "tab-search-",
      title: "Distinctive design session",
    });
    try {
      const second = await workspace.client.createAgent({
        provider: "mock",
        cwd: workspace.cwd,
        workspaceId: workspace.workspaceId,
        title: "Implementation session",
        modeId: "load-test",
        model: "e2e-fast-stream",
      });
      await openAgentRoute(page, workspace);
      await expect(page.getByRole("textbox", { name: composerName })).toBeEditable();
      await page.getByTestId("workspace-split-pane-menu").first().click();
      await page.getByTestId("workspace-split-pane-right-with-session").click();
      const sessionPicker = page.getByTestId("view-session-picker");
      await sessionPicker.getByTestId("view-session-picker-search").fill(second.id.slice(0, 8));
      await sessionPicker.getByTestId(`view-session-picker-row-${second.id}`).click();
      await expect(page.getByRole("textbox", { name: composerName })).toHaveCount(2);
      if (compact) await page.setViewportSize({ width: 390, height: 844 });
      else
        await page.getByTestId("workspace-maximize-pane").filter({ visible: true }).last().click();
      const composer = page
        .getByRole("textbox", { name: composerName })
        .filter({ visible: true })
        .last();
      await composer.fill("Keep this unsent draft");
      const trigger = page
        .getByTestId(compact ? "workspace-tab-switcher-trigger" : "workspace-tab-search-trigger")
        .filter({ visible: true })
        .first();
      await trigger.click();
      const search = page.getByRole("combobox", { name: "Search tabs…" });
      await expect(search).toBeVisible();
      await search.fill("Distinctive design");
      await expect(page.getByRole("option")).toHaveCount(1);
      await expect(page.getByRole("option")).toContainText("Distinctive design session");
      await expect(page.getByRole("option")).toContainText("Pane 1");
      await page.screenshot({ path: testInfo.outputPath("title-search.png") });
      await search.press("Escape");
      await expect(search).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await expect(composer).toHaveValue("Keep this unsent draft");
      await trigger.click();
      await search.fill("Distinctive design");
      await search.press("ArrowDown");
      await search.press("Enter");
      await expect(search).toHaveCount(0);
      if (compact) await expect(trigger).toContainText("Distinctive design session");
      else {
        await expect(page.getByTestId("pane-unmaximized-toast")).toBeVisible();
        await expect(
          page.getByRole("textbox", { name: composerName }).filter({ visible: true }),
        ).toHaveCount(2);
        await expect(
          page
            .getByTestId(`workspace-tab-agent_${workspace.agentId}`)
            .filter({ visible: true })
            .first(),
        ).toHaveAttribute("aria-selected", "true");
      }
      await trigger.click();
      await search.fill("absolutely-no-matching-title-987654321");
      await expect(page.getByText("No matching tabs", { exact: true })).toBeVisible();
      await search.press("Enter");
      await expect(search).toBeVisible();
      await search.press("Escape");
    } finally {
      await workspace.cleanup();
    }
  });
}
