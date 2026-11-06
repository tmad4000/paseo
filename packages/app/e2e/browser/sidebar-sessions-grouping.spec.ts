import { expect, test, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { openCommandCenter } from "../support/helpers/command-center";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { closeSidebarDisplayPreferences, openSidebarDisplayPage } from "../support/helpers/sidebar";

const AS_SESSIONS = "Show chats as sessions";
const GROUP_BY_PROJECT = "Group by project";

// Sessions grouping (docs/sidebar-sorting.md#sessions-grouping): below the pinned section the
// sidebar lists chats, not workspaces. A row opens that chat in its home workspace, and the find
// field narrows the list by chat title.
async function runGroupingEntry(page: Page, label: string): Promise<void> {
  const panel = await openCommandCenter(page);
  await panel.getByTestId("command-center-input").fill("group");
  const entry = panel.getByText(label, { exact: true });
  await expect(entry).toBeVisible({ timeout: 30_000 });
  await entry.click();
  await expect(page.getByTestId("command-center-panel")).not.toBeVisible({ timeout: 30_000 });
}

function sessionRow(page: Page, agentId: string) {
  return page.getByTestId(`sidebar-session-${getServerId()}-${agentId}`);
}

test.describe("Sidebar sessions grouping", () => {
  test.describe.configure({ timeout: 180_000 });
  let workspace: SeededWorkspace;
  let first: { id: string };
  let second: { id: string };

  test.beforeAll(async () => {
    workspace = await seedWorkspace({ repoPrefix: "sidebar-sessions-grouping-" });
    first = await workspace.client.createAgent({
      provider: "mock",
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Sessions grouping alpha",
      modeId: "load-test",
      model: "e2e-fast-stream",
    });
    second = await workspace.client.createAgent({
      provider: "mock",
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Sessions grouping beta",
      modeId: "load-test",
      model: "e2e-fast-stream",
    });
  });

  test.afterAll(async () => {
    await workspace?.cleanup();
  });

  test("switches to sessions, opens a chat from its row, and filters by title", async ({
    page,
  }) => {
    await gotoAppShell(page);
    const projectList = page.getByTestId("sidebar-project-workspace-list-scroll");
    const sessionList = page.getByTestId("sidebar-session-list");
    await expect(projectList).toBeVisible({ timeout: 30_000 });

    // Display preferences > Grouping offers Sessions as the fourth mode.
    await openSidebarDisplayPage(page, "sidebar-display-grouping");
    await page.getByTestId("sidebar-grouping-sessions").click();
    await closeSidebarDisplayPreferences(page);

    await expect(sessionList).toBeVisible({ timeout: 30_000 });
    await expect(projectList).toHaveCount(0);
    // Chats, not workspaces: no workspace row sits in the list.
    await expect(
      sessionList.getByTestId(`sidebar-workspace-row-${getServerId()}:${workspace.workspaceId}`),
    ).toHaveCount(0);
    for (const agent of [first, second]) {
      await expect(sessionRow(page, agent.id)).toBeVisible({ timeout: 30_000 });
    }
    const meta = page.getByTestId(`sidebar-session-${getServerId()}-${first.id}-meta`);
    await expect(meta).toContainText("·");

    // The choice survives a reload.
    await page.reload();
    await expect(sessionList).toBeVisible({ timeout: 30_000 });

    // A row opens its chat's tab in its home workspace.
    await sessionRow(page, second.id).click();
    await page.waitForURL((url) => url.pathname.includes("/workspace/"), { timeout: 60_000 });
    const secondTab = page
      .getByTestId(`workspace-tab-agent_${second.id}`)
      .filter({ visible: true });
    await expect(secondTab).toHaveAttribute("aria-selected", "true", { timeout: 30_000 });

    // The find field narrows sessions by title.
    const field = page.getByTestId("sidebar-title-project-filter");
    await field.click();
    await field.fill("grouping alpha");
    await expect(sessionRow(page, first.id)).toBeVisible({ timeout: 30_000 });
    await expect(sessionRow(page, second.id)).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath("sessions-filtered.png") });
    await field.fill("");
    await expect(sessionRow(page, second.id)).toBeVisible({ timeout: 30_000 });

    // The row menu carries the agent tab's actions.
    await page.getByTestId(`sidebar-session-${getServerId()}-${first.id}-actions`).click();
    await expect(
      page.getByTestId(`sidebar-session-${getServerId()}-${first.id}-pin`),
    ).toBeVisible();
    await expect(
      page.getByTestId(`sidebar-session-${getServerId()}-${first.id}-rename`),
    ).toBeVisible();
    await expect(
      page.getByTestId(`sidebar-session-${getServerId()}-${first.id}-archive`),
    ).toBeVisible();
    await expect(page.getByTestId("manual-status-menu")).toBeVisible();
    await page.keyboard.press("Escape");

    // Command Center offers the way back; grouping persists, so leave project mode behind.
    await runGroupingEntry(page, GROUP_BY_PROJECT);
    await expect(projectList).toBeVisible({ timeout: 30_000 });
    await expect(sessionList).toHaveCount(0);
    await runGroupingEntry(page, AS_SESSIONS);
    await expect(sessionList).toBeVisible({ timeout: 30_000 });
    await runGroupingEntry(page, GROUP_BY_PROJECT);
    await expect(projectList).toBeVisible({ timeout: 30_000 });
  });
});
