import { expect, test } from "../support/fixtures";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { seedWorkspace } from "../support/helpers/seed-client";

test.use({ launchOptions: { chromiumSandbox: true } });

test("stacked panes reduce composer chrome and retain a growing draft through resize", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const workspace = await seedWorkspace({ repoPrefix: "composer-stacked-" });
  try {
    const agents = [];
    for (const title of ["Upper chat", "Lower chat"]) {
      const agent = await workspace.client.createAgent({
        provider: "mock",
        model: "ten-second-stream",
        modeId: "load-test",
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title,
      });
      await workspace.client.waitForAgentUpsert(agent.id, (snapshot) => snapshot.status === "idle");
      agents.push(agent);
    }
    await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: agents[0].id });
    const roots = page.getByTestId("message-input-root").filter({ visible: true });
    await expect(roots).toHaveCount(1);
    const fullHeight = (await roots.first().boundingBox())!.height;

    await page.getByTestId("workspace-split-pane-menu").first().click();
    await page.getByTestId("workspace-split-pane-down-with-session").click();
    const picker = page.getByTestId("view-session-picker");
    await picker.getByTestId("view-session-picker-search").fill(agents[1].id.slice(0, 8));
    await picker.getByTestId(`view-session-picker-row-${agents[1].id}`).click();
    await expect(roots).toHaveCount(2);
    for (let i = 0; i < 2; i++) {
      await expect
        .poll(async () => (await roots.nth(i).boundingBox())!.height)
        .toBeLessThan(fullHeight - 20);
      await expect(roots.nth(i).getByRole("textbox")).toBeEditable();
    }
    await page.screenshot({ path: test.info().outputPath("stacked-composer-compact.png") });
    const input = roots.first().getByRole("textbox");
    const draft = Array.from({ length: 40 }, (_, i) => `Draft line ${i + 1}`).join("\n");
    await input.fill(draft);
    await expect(input).toHaveValue(draft);
    await expect.poll(async () => (await input.boundingBox())!.height).toBeLessThan(160);
    await page.setViewportSize({ width: 1440, height: 700 });
    await expect.poll(async () => (await input.boundingBox())!.height).toBeLessThan(110);
    await expect(input).toHaveValue(draft);
    await page.setViewportSize({ width: 1440, height: 1400 });
    await expect.poll(async () => (await input.boundingBox())!.height).toBeGreaterThan(160);
    await expect(input).toHaveValue(draft);
    await page.screenshot({ path: test.info().outputPath("stacked-composer-resized.png") });
  } finally {
    await workspace.cleanup();
  }
});
