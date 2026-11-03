import { expect, test } from "../support/fixtures";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

const COMPOSER = "Message agent...";

test.describe("New Tab split preview", () => {
  test("hovering + offers Split right / Split down and each opens a new tab in one click", async ({
    page,
  }) => {
    const agent = await seedMockAgentWorkspace({
      repoPrefix: "new-tab-split-",
      title: "Split from plus",
    });
    try {
      await agent.client.waitForAgentUpsert(agent.agentId, (s) => s.status === "idle");
      await openAgentRoute(page, { workspaceId: agent.workspaceId, agentId: agent.agentId });
      await expect(page.getByRole("textbox", { name: COMPOSER })).toBeEditable({
        timeout: 30_000,
      });
      const plusButtons = page.getByTestId("workspace-new-tab-button").filter({ visible: true });
      await expect(plusButtons).toHaveCount(1);

      // Hover shows the split choices, and Split right adds a pane with a fresh tab.
      await plusButtons.first().hover();
      const preview = page.getByTestId("workspace-new-tab-split-menu");
      await expect(preview).toBeVisible();
      await expect(preview.getByTestId("workspace-new-tab-split-right")).toContainText(
        "Split pane right",
      );
      await expect(preview.getByTestId("workspace-new-tab-split-down")).toContainText(
        "Split pane down",
      );
      await page.screenshot({ path: test.info().outputPath("new-tab-split-preview.png") });
      await preview.getByTestId("workspace-new-tab-split-right").click();
      await expect(plusButtons).toHaveCount(2, { timeout: 15_000 });
      await expect(page.getByTestId("workspace-new-tab-split-menu")).toHaveCount(0);
      // The composer of the original session is still the only chat; the new pane is a new tab.
      await expect(page.getByRole("textbox", { name: COMPOSER })).toHaveCount(1);

      // Leaving and hovering the new pane's + splits it downward.
      await page.mouse.move(5, 400);
      await plusButtons.nth(1).hover();
      await expect(page.getByTestId("workspace-new-tab-split-menu")).toBeVisible();
      await page.getByTestId("workspace-new-tab-split-down").click();
      await expect(plusButtons).toHaveCount(3, { timeout: 15_000 });
      await page.screenshot({ path: test.info().outputPath("new-tab-split-after.png") });

      // A plain click keeps opening the New Tab menu and never the split preview.
      await plusButtons.first().click();
      await expect(page.getByTestId("workspace-new-tab-menu")).toBeVisible();
      await expect(page.getByTestId("workspace-new-tab-split-menu")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("workspace-new-tab-menu")).toHaveCount(0);
      await page.mouse.move(5, 400);

      // Moving away closes a preview without choosing.
      await plusButtons.first().hover();
      await expect(page.getByTestId("workspace-new-tab-split-menu")).toBeVisible();
      await page.mouse.move(5, 400);
      await expect(page.getByTestId("workspace-new-tab-split-menu")).toHaveCount(0);
    } finally {
      await agent.cleanup();
    }
  });
});
