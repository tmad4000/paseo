import { expect, test } from "../support/fixtures";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";

const COMPOSER = "Message agent...";

test.describe.configure({ timeout: 120_000 });

test.describe("Maximized pane", () => {
  let workspace: SeededWorkspace;

  test.beforeAll(async () => {
    workspace = await seedWorkspace({ repoPrefix: "maximized-pane-reveal-" });
  });

  test.afterAll(async () => {
    await workspace?.cleanup();
  });

  test("Back to a covered pane restores the split, says so, and can maximize the destination", async ({
    page,
  }) => {
    const create = (title: string) =>
      workspace.client.createAgent({
        provider: "mock",
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title,
        modeId: "load-test",
        model: "ten-second-stream",
      });
    const left = await create("Left session");
    const right = await create("Right session");
    for (const id of [left.id, right.id]) {
      await workspace.client.waitForAgentUpsert(id, (s) => s.status === "idle");
    }
    await page.setViewportSize({ width: 1400, height: 900 });
    await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: left.id });
    await expect(page.getByRole("textbox", { name: COMPOSER })).toBeEditable({ timeout: 30_000 });

    await page.getByTestId("workspace-split-pane-menu").first().click();
    await page.getByTestId("workspace-split-pane-right-with-session").click();
    const picker = page.getByTestId("view-session-picker");
    await picker.getByTestId("view-session-picker-search").fill(right.id.slice(0, 8));
    await picker.getByTestId(`view-session-picker-row-${right.id}`).click();
    await expect(page.getByRole("textbox", { name: COMPOSER })).toHaveCount(2, { timeout: 30_000 });

    // Maximize the pane we landed in: the other pane is covered.
    const rightTab = page.getByTestId(`workspace-tab-agent_${right.id}`).filter({ visible: true });
    await rightTab.first().click({ position: { x: 12, y: 13 } });
    await page.getByTestId("workspace-maximize-pane").filter({ visible: true }).last().click();
    await expect(page.getByTestId("workspace-restore-pane").filter({ visible: true })).toHaveCount(
      1,
    );
    await expect(
      page.getByRole("textbox", { name: COMPOSER }).filter({ visible: true }),
    ).toHaveCount(1);

    // Back goes to the covered session. It must not look like nothing happened.
    await page.getByTestId("navigation-back-button").filter({ visible: true }).first().click();
    const toast = page.getByTestId("pane-unmaximized-toast");
    await expect(toast).toBeVisible();
    await expect(toast).toContainText("Unmaximized the pane to show this tab");
    await expect(
      page.getByRole("textbox", { name: COMPOSER }).filter({ visible: true }),
    ).toHaveCount(2);
    await expect(
      page.getByTestId(`workspace-tab-agent_${left.id}`).filter({ visible: true }).first(),
    ).toHaveAttribute("aria-selected", "true");
    await page.screenshot({ path: test.info().outputPath("maximized-pane-revealed.png") });

    // The toast's action maximizes where Back landed.
    await toast.getByTestId("pane-unmaximized-toast-maximize").click();
    await expect(toast).toBeHidden();
    await expect(
      page.getByRole("textbox", { name: COMPOSER }).filter({ visible: true }),
    ).toHaveCount(1);
    await expect(
      page.getByTestId(`workspace-tab-agent_${left.id}`).filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByTestId(`workspace-tab-agent_${right.id}`).filter({ visible: true }),
    ).toHaveCount(0);
  });
});
