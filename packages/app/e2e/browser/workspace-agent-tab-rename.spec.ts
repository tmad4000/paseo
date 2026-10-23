import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "../support/fixtures";
import { seedWorkspace, type SeedDaemonClient } from "../support/helpers/seed-client";
import { createIdleAgent, expectWorkspaceTabVisible } from "../support/helpers/archive-tab";
import { waitForWorkspaceTabsVisible } from "../support/helpers/workspace-tabs";
import { buildHostAgentDetailRoute } from "@/utils/host-routes";
import { renameModalInput, renameModalSubmit } from "../support/helpers/rename";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { getServerId } from "../support/helpers/server-id";

async function openAgentInWorkspace(page: Page, agent: { id: string; workspaceId: string }) {
  await page.goto(buildHostAgentDetailRoute(getServerId(), agent.id, agent.workspaceId));
  await page.waitForURL(
    (url) => url.pathname.includes("/workspace/") && !url.searchParams.has("open"),
    { timeout: 60_000 },
  );
  await waitForWorkspaceTabsVisible(page);
  await expectWorkspaceTabVisible(page, agent.id);
}

async function fetchAgentTitle(client: SeedDaemonClient, agentId: string): Promise<string | null> {
  const result = await client.fetchAgents({ scope: "active" });
  return result.entries.find((entry) => entry.agent.id === agentId)?.agent.title ?? null;
}

test.describe("Workspace agent tab rename", () => {
  for (const viewport of [
    { name: "desktop", width: 1280, height: 800 },
    { name: "compact", width: 390, height: 844 },
  ]) {
    test(`top-bar rename follows the selected session on ${viewport.name}`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(120_000);
      await page.setViewportSize(viewport);
      const session = await seedMockAgentWorkspace({
        repoPrefix: "workspace-header-rename-",
        title: "First session",
      });
      try {
        const second = await session.client.createAgent({
          provider: "mock",
          cwd: session.cwd,
          workspaceId: session.workspaceId,
          title: "Second session",
          modeId: "load-test",
          model: "e2e-fast-stream",
        });
        await openAgentRoute(page, session);
        await openAgentRoute(page, { ...session, agentId: second.id });
        await page.getByTestId("workspace-header-menu-trigger").filter({ visible: true }).click();
        const rename = page.getByTestId("workspace-header-rename-tab");
        await expect(rename).toHaveText("Rename agent");
        await rename.click({ trial: true });
        await page.screenshot({
          path: testInfo.outputPath("header-menu.png"),
          animations: "disabled",
        });
        await rename.click();

        const prefix = `workspace-tab-rename-modal-agent-${second.id}`;
        const input = renameModalInput(page, prefix);
        await expect(input).toHaveValue("Second session");
        await expect(input).toBeFocused();
        await input.fill("   ");
        await expect(renameModalSubmit(page, prefix)).toBeDisabled();
        await input.fill("Discard this name");
        await page.getByTestId(`${prefix}-cancel`).click();
        await expect(input).toHaveCount(0);
        await expect.poll(() => fetchAgentTitle(session.client, second.id)).toBe("Second session");

        await page.getByTestId("workspace-header-menu-trigger").filter({ visible: true }).click();
        await rename.click();
        await expect(input).toHaveValue("Second session");
        await input.fill("Renamed from the top bar");
        await input.click({ trial: true });
        await page.screenshot({
          path: testInfo.outputPath("rename-dialog.png"),
          animations: "disabled",
        });
        await input.press("Enter");
        await expect(input).toHaveCount(0);
        await expect
          .poll(() => fetchAgentTitle(session.client, second.id))
          .toBe("Renamed from the top bar");
        await expect
          .poll(() => fetchAgentTitle(session.client, session.agentId))
          .toBe("First session");
        const activeLabel =
          viewport.name === "compact"
            ? page.getByTestId("workspace-tab-switcher-trigger")
            : page.getByTestId(`workspace-tab-agent_${second.id}`).first();
        await expect(activeLabel).toContainText("Renamed from the top bar");
        await page.reload();
        await expect(activeLabel).toContainText("Renamed from the top bar");
      } finally {
        await session.cleanup();
      }
    });
  }

  test("right-click rename persists the agent title and updates the tab label", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const workspace = await seedWorkspace({ repoPrefix: "workspace-agent-rename-" });

    try {
      const initialTitle = `agent-rename-${randomUUID().slice(0, 8)}`;
      const agent = await createIdleAgent(workspace.client, {
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: initialTitle,
      });

      await openAgentInWorkspace(page, agent);

      const tab = page.getByTestId(`workspace-tab-agent_${agent.id}`).first();
      await expect(tab).toContainText(initialTitle, { timeout: 15_000 });

      await tab.click({ button: "right" });
      await expect(page.getByTestId(`workspace-tab-context-agent_${agent.id}`)).toBeVisible({
        timeout: 10_000,
      });
      const renameItem = page.getByTestId(`workspace-tab-context-agent_${agent.id}-rename`);
      await expect(renameItem).toBeVisible({ timeout: 10_000 });
      await renameItem.click();

      const modalPrefix = `workspace-tab-rename-modal-agent-${agent.id}`;
      const input = renameModalInput(page, modalPrefix);
      await expect(input).toBeVisible({ timeout: 10_000 });
      await expect(input).toHaveValue(initialTitle);

      const renamed = "My Renamed Agent";
      await input.fill(renamed);
      await renameModalSubmit(page, modalPrefix).click();

      await expect(input).toHaveCount(0, { timeout: 15_000 });
      await expect(tab).toContainText(renamed, { timeout: 15_000 });
      await expect.poll(() => fetchAgentTitle(workspace.client, agent.id)).toBe(renamed);
    } finally {
      await workspace.cleanup();
    }
  });
});
