import { expect, test } from "../support/fixtures";
import { closeWorkspaceAgentTab } from "../support/helpers/archive-tab";
import { closeCommandCenter, openCommandCenter } from "../support/helpers/command-center";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";

const PARENT_COMPOSER = "Message agent...";

interface SeededSessions {
  home: { id: string; workspaceId: string; title: string };
  other: { id: string; workspaceId: string; title: string };
}

/** One session in the seeded workspace and one in a second workspace of the same project. */
async function seedTwoWorkspaces(
  workspace: SeededWorkspace,
  titles: { home: string; other: string },
): Promise<SeededSessions> {
  const home = await workspace.client.createAgent({
    provider: "mock",
    cwd: workspace.repoPath,
    workspaceId: workspace.workspaceId,
    title: titles.home,
    modeId: "load-test",
    model: "ten-second-stream",
  });
  const created = await workspace.client.createWorkspace({
    source: { kind: "directory", path: workspace.repoPath, projectId: workspace.projectId },
    title: `${titles.other} workspace`,
  });
  if (!created.workspace) throw new Error(created.error ?? "Failed to create second workspace");
  const other = await workspace.client.createAgent({
    provider: "mock",
    cwd: workspace.repoPath,
    workspaceId: created.workspace.id,
    title: titles.other,
    modeId: "load-test",
    model: "ten-second-stream",
  });
  for (const id of [home.id, other.id]) {
    await workspace.client.waitForAgentUpsert(id, (s) => s.status === "idle");
  }
  return {
    home: { id: home.id, workspaceId: workspace.workspaceId, title: titles.home },
    other: { id: other.id, workspaceId: created.workspace.id, title: titles.other },
  };
}

async function archivedAt(workspace: SeededWorkspace, agentId: string) {
  const result = await workspace.client.fetchAgent({ agentId });
  return (result?.agent as { archivedAt?: string | null } | undefined)?.archivedAt ?? null;
}

test.describe("Split with session", () => {
  let workspace: SeededWorkspace;

  test.beforeAll(async () => {
    workspace = await seedWorkspace({ repoPrefix: "split-with-session-" });
  });

  test.afterAll(async () => {
    await workspace?.cleanup();
  });

  test("splits a normal session and drops another workspace's session in by short id", async ({
    page,
  }) => {
    const sessions = await seedTwoWorkspaces(workspace, {
      home: "Orchestrator home",
      other: "Billing worker",
    });
    await openAgentRoute(page, {
      workspaceId: sessions.home.workspaceId,
      agentId: sessions.home.id,
    });
    const routeBefore = page.url();
    await expect(page.getByRole("textbox", { name: PARENT_COMPOSER })).toBeEditable({
      timeout: 30_000,
    });

    await page.getByTestId("workspace-split-pane-menu").first().click();
    await page.getByTestId("workspace-split-pane-right-with-session").click();
    const picker = page.getByTestId("view-session-picker");
    await expect(picker).toBeVisible();
    await picker.getByTestId("view-session-picker-search").fill(sessions.other.id.slice(0, 8));
    const row = picker.getByTestId(`view-session-picker-row-${sessions.other.id}`);
    await expect(row).toBeVisible();
    await expect(row).toContainText(`mock · ${sessions.other.id.slice(0, 8)}`);
    await row.click();

    // Two panes, both sessions on screen, still the original workspace route.
    await expect(page.getByRole("textbox", { name: PARENT_COMPOSER })).toHaveCount(2, {
      timeout: 30_000,
    });
    await expect(page.getByText("Billing worker").first()).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(new URL(routeBefore).pathname);
    await page.screenshot({ path: test.info().outputPath("split-with-session.png") });

    // The dropped-in session survives a reload (the explicit open keeps it through reconcile)...
    await page.reload();
    await expect(page.getByRole("textbox", { name: PARENT_COMPOSER })).toHaveCount(2, {
      timeout: 60_000,
    });
    // ...and closing it only leaves this layout: it still belongs to, and lives in, its own.
    // The close control is revealed on hover, like every desktop tab.
    await page
      .getByTestId(`workspace-tab-agent_${sessions.other.id}`)
      .filter({ visible: true })
      .first()
      .hover();
    await closeWorkspaceAgentTab(page, sessions.other.id);
    await expect(page.getByRole("textbox", { name: PARENT_COMPOSER })).toHaveCount(1, {
      timeout: 30_000,
    });
    expect(await archivedAt(workspace, sessions.other.id)).toBeNull();
  });

  test("finds a session by a pasted id in global search and in the sidebar", async ({ page }) => {
    const sessions = await seedTwoWorkspaces(workspace, {
      home: "Search home",
      other: "Id-only target",
    });
    await openAgentRoute(page, {
      workspaceId: sessions.home.workspaceId,
      agentId: sessions.home.id,
    });
    const serverId = getServerId();

    const panel = await openCommandCenter(page);
    await panel.getByTestId("command-center-input").fill(sessions.other.id.slice(0, 8));
    await expect(
      panel.getByTestId(`command-center-agent-${serverId}:${sessions.other.id}`).first(),
    ).toBeVisible({ timeout: 30_000 });
    await closeCommandCenter(page);

    await page.getByTestId("sidebar-title-project-filter").fill(sessions.other.id);
    await expect(
      page.getByTestId(`sidebar-filter-tab-match-${serverId}-${sessions.other.id}`),
    ).toBeVisible({ timeout: 30_000 });
  });

  test("an orchestrator drops another workspace's session beside the user without moving focus", async ({
    page,
  }) => {
    const sessions = await seedTwoWorkspaces(workspace, {
      home: "Agent-driven home",
      other: "Dropped session",
    });
    await openAgentRoute(page, {
      workspaceId: sessions.home.workspaceId,
      agentId: sessions.home.id,
    });
    // The home session's composer: the first pane stays first when a split opens beside it.
    const composer = page.getByRole("textbox", { name: PARENT_COMPOSER }).first();
    await expect(composer).toBeEditable({ timeout: 30_000 });
    await composer.click();
    await composer.fill("typing here");
    const routeBefore = page.url();

    // What `open_tab { target: agent, placement: "side" }` and `paseo ui open-tab --side` send.
    const opened = await workspace.client.openWorkspaceTab({
      workspaceId: sessions.home.workspaceId,
      target: { kind: "agent", agentId: sessions.other.id },
      placement: "side",
    });
    expect(opened.error).toBeNull();

    await expect(page.getByRole("textbox", { name: PARENT_COMPOSER })).toHaveCount(2, {
      timeout: 30_000,
    });
    await expect(composer).toBeFocused();
    await expect(composer).toHaveValue("typing here");
    expect(page.url()).toBe(routeBefore);

    // Archived from anywhere, the dropped-in session leaves this layout too.
    await workspace.client.archiveAgent(sessions.other.id);
    await expect(page.getByRole("textbox", { name: PARENT_COMPOSER })).toHaveCount(1, {
      timeout: 30_000,
    });
  });
});
