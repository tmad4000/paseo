import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";

const COMPOSER = "Message agent...";
const SESSION_PIN_LABEL = "paseo.session-pinned-at";

interface Sessions {
  home: { id: string; workspaceId: string };
  other: { id: string; title: string };
}

/** A session in the seeded workspace, and a pinned one in a second workspace of the same project. */
async function seedPinnedForeignSession(
  workspace: SeededWorkspace,
  titles: { home: string; other: string },
): Promise<Sessions> {
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
  await workspace.client.updateAgent(other.id, {
    labels: { [SESSION_PIN_LABEL]: new Date().toISOString() },
  });
  return {
    home: { id: home.id, workspaceId: workspace.workspaceId },
    other: { id: other.id, title: titles.other },
  };
}

async function center(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Element has no bounding box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

/** Press on the row, then move in steps so the sidebar list and the cross drop both see motion. */
async function dragRowTo(page: Page, row: Locator, to: { x: number; y: number }) {
  const from = await center(row);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 20 });
}

async function openHome(page: Page, sessions: Sessions) {
  await openAgentRoute(page, { workspaceId: sessions.home.workspaceId, agentId: sessions.home.id });
  await expect(page.getByRole("textbox", { name: COMPOSER })).toBeEditable({ timeout: 30_000 });
  const row = page.getByTestId(`sidebar-pinned-session-${sessions.other.id}`).filter({
    visible: true,
  });
  await expect(row).toBeVisible({ timeout: 30_000 });
  return row;
}

test.describe("Sidebar drag to split", () => {
  let workspace: SeededWorkspace;

  test.beforeAll(async () => {
    workspace = await seedWorkspace({ repoPrefix: "sidebar-drag-to-split-" });
  });

  test.afterAll(async () => {
    await workspace?.cleanup();
  });

  test("dropping a pinned session on the right edge splits it in beside the current one", async ({
    page,
  }) => {
    const sessions = await seedPinnedForeignSession(workspace, {
      home: "Drag home",
      other: "Dragged billing worker",
    });
    const row = await openHome(page, sessions);
    const routeBefore = new URL(page.url()).pathname;
    const pane = page.locator("[data-sidebar-drop-pane]").filter({ visible: true }).first();
    const { box } = await center(pane);

    await dragRowTo(page, row, { x: box.x + box.width - 12, y: box.y + box.height / 2 });
    await page.screenshot({ path: test.info().outputPath("sidebar-drag-right-edge.png") });
    await page.mouse.up();

    await expect(page.getByRole("textbox", { name: COMPOSER })).toHaveCount(2, {
      timeout: 30_000,
    });
    await expect(page.locator("[data-sidebar-drop-pane]").filter({ visible: true })).toHaveCount(2);
    await expect(
      page.getByTestId(`workspace-tab-agent_${sessions.other.id}`).filter({ visible: true }),
    ).toHaveCount(1);
    expect(new URL(page.url()).pathname).toBe(routeBefore);
    await page.screenshot({ path: test.info().outputPath("sidebar-drag-split.png") });
  });

  test("dropping a pinned session on a tab strip opens it as a tab in that pane", async ({
    page,
  }) => {
    const sessions = await seedPinnedForeignSession(workspace, {
      home: "Tab drop home",
      other: "Dragged tab worker",
    });
    const row = await openHome(page, sessions);
    const tabs = page.getByTestId("workspace-tabs-row").filter({ visible: true }).first();
    const { box } = await center(tabs);

    await dragRowTo(page, row, { x: box.x + box.width * 0.6, y: box.y + box.height / 2 });
    await expect(
      page.locator('[data-testid^="workspace-tabs-drop-preview-"]').filter({ visible: true }),
    ).toHaveCount(1);
    await page.mouse.up();

    await expect(
      page.getByTestId(`workspace-tab-agent_${sessions.other.id}`).filter({ visible: true }),
    ).toHaveCount(1, { timeout: 30_000 });
    await expect(
      page.getByTestId(`workspace-tab-agent_${sessions.home.id}`).filter({ visible: true }),
    ).toHaveCount(1);
    await expect(page.locator("[data-sidebar-drop-pane]").filter({ visible: true })).toHaveCount(1);
    await expect(
      page.locator('[data-testid^="workspace-tabs-drop-preview-"]').filter({ visible: true }),
    ).toHaveCount(0);
  });
});
