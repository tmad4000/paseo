import { randomUUID } from "node:crypto";
import { test, expect } from "../support/fixtures";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

for (const viewport of [
  { name: "desktop", width: 1280, height: 800 },
  { name: "phone width", width: 390, height: 844 },
]) {
  test(`background tab activity is ordered and clears on visit at ${viewport.name}`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const session = await seedMockAgentWorkspace({
      repoPrefix: "workspace-tab-activity-",
      title: `first-${randomUUID().slice(0, 6)}`,
    });
    try {
      const second = await session.client.createAgent({
        provider: "mock",
        cwd: session.cwd,
        workspaceId: session.workspaceId,
        title: "second tab",
        modeId: "load-test",
        model: "e2e-fast-stream",
      });
      const third = await session.client.createAgent({
        provider: "mock",
        cwd: session.cwd,
        workspaceId: session.workspaceId,
        title: "third tab",
        modeId: "load-test",
        model: "e2e-fast-stream",
      });
      await openAgentRoute(page, session);
      await openAgentRoute(page, { workspaceId: session.workspaceId, agentId: second.id });
      await openAgentRoute(page, { workspaceId: session.workspaceId, agentId: third.id });

      if (viewport.name === "phone width") {
        await page.getByTestId("workspace-tab-switcher-trigger").click();
        await expect(
          page.getByTestId(`workspace-tab-menu-agent_${session.agentId}-trigger`),
        ).toBeVisible();
        await expect(page.getByTestId(`workspace-tab-unread-agent_${session.agentId}`)).toHaveCount(
          0,
        );
        await page.getByRole("button", { name: "Bottom sheet backdrop" }).first().click();
      } else {
        await expect(page.getByTestId(`workspace-tab-agent_${session.agentId}`)).toBeVisible();
        await expect(page.getByTestId(`workspace-tab-unread-agent_${session.agentId}`)).toHaveCount(
          0,
        );
      }

      await session.client.sendAgentMessage(session.agentId, "Report a short result");
      await session.client.waitForFinish(session.agentId);
      const unread = page.getByTestId(`workspace-tab-unread-agent_${session.agentId}`);
      if (viewport.name === "phone width") {
        await page.getByTestId("workspace-tab-switcher-trigger").click();
        await expect(unread).toBeVisible();
        const ids = await page
          .locator('[data-testid^="workspace-tab-menu-agent_"][data-testid$="-trigger"]')
          .evaluateAll((elements) =>
            elements.map((element) => element.getAttribute("data-testid")),
          );
        expect(ids[0]).toBe(`workspace-tab-menu-agent_${session.agentId}-trigger`);
        await page.getByRole("button", { name: /first-.*New activity/ }).click();
      } else {
        await expect(unread).toBeVisible();
        const ids = await page
          .locator('[data-testid^="workspace-tab-agent_"]')
          .evaluateAll((elements) =>
            elements.map((element) => element.getAttribute("data-testid")),
          );
        expect(ids[0]).toBe(`workspace-tab-agent_${session.agentId}`);
        await page.getByTestId(`workspace-tab-agent_${session.agentId}`).click();
      }
      await expect(unread).toHaveCount(0);
    } finally {
      await session.cleanup();
    }
  });
}
