import { expect, test, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { openCommandCenter } from "../support/helpers/command-center";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";

const GROUP_BY_STATUS = "Group by status";
const GROUP_BY_PROJECT = "Group by project";
const ONE_LIST = "Show chats in one list";

// Result rows carry no testID of their own, so the entries are addressed by their visible label.
// `current` is the mode the sidebar is in: its entry must never be listed, since it would be a no-op.
async function runGroupingEntry(page: Page, label: string, current: string): Promise<void> {
  const panel = await openCommandCenter(page);
  await panel.getByTestId("command-center-input").fill("group");

  const entry = panel.getByText(label, { exact: true });
  await expect(entry).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByText(current, { exact: true })).toHaveCount(0);

  await entry.click();
  await expect(page.getByTestId("command-center-panel")).not.toBeVisible({ timeout: 30_000 });
}

test.describe("Command center sidebar grouping", () => {
  test.describe.configure({ timeout: 180_000 });

  test("switches between all three groupings and persists each across a reload", async ({
    page,
  }) => {
    const seeded = await seedWorkspace({ repoPrefix: "command-center-grouping-" });

    try {
      await gotoAppShell(page);
      const projectList = page.getByTestId("sidebar-project-workspace-list-scroll");
      const statusList = page.getByTestId("sidebar-status-list-scroll");
      const oneListRows = page.getByTestId("sidebar-status-group-rows-list");
      const seededRow = page.getByTestId(
        `sidebar-workspace-row-${getServerId()}:${seeded.workspaceId}`,
      );
      await expect(projectList).toBeVisible({ timeout: 30_000 });

      // Query-only: the grouping entries stay out of the default empty-query list.
      const panel = await openCommandCenter(page);
      for (const label of [GROUP_BY_STATUS, GROUP_BY_PROJECT, ONE_LIST]) {
        await expect(panel.getByText(label, { exact: true })).toHaveCount(0);
      }
      await page.keyboard.press("Escape");
      await expect(panel).not.toBeVisible({ timeout: 30_000 });

      await runGroupingEntry(page, GROUP_BY_STATUS, GROUP_BY_PROJECT);
      await expect(statusList).toBeVisible({ timeout: 30_000 });
      await expect(projectList).toHaveCount(0);

      // The only assertion that catches a flip which never reached persisted storage.
      await page.reload();
      await expect(statusList).toBeVisible({ timeout: 30_000 });

      // One list: a single headerless run of rows, no status headers, each row still placed.
      await runGroupingEntry(page, ONE_LIST, GROUP_BY_STATUS);
      await expect(
        oneListRows.getByTestId(`sidebar-workspace-row-${getServerId()}:${seeded.workspaceId}`),
      ).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByTestId("sidebar-status-group-list")).toHaveCount(0);
      for (const bucket of ["needs_input", "failed", "attention", "running", "done"]) {
        await expect(page.getByTestId(`sidebar-status-group-${bucket}`)).toHaveCount(0);
      }
      await expect(
        page.getByTestId(`sidebar-row-project-icon-${getServerId()}:${seeded.workspaceId}`),
      ).toBeVisible({ timeout: 30_000 });

      await page.reload();
      await expect(oneListRows).toBeVisible({ timeout: 30_000 });
      await expect(seededRow).toBeVisible({ timeout: 30_000 });

      // Grouping persists, so the run must leave the sidebar back in project mode.
      await runGroupingEntry(page, GROUP_BY_PROJECT, ONE_LIST);
      await expect(projectList).toBeVisible({ timeout: 30_000 });
      await expect(statusList).toHaveCount(0);
    } finally {
      await seeded.cleanup().catch(() => undefined);
    }
  });
});
