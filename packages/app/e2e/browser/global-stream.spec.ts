import { expect } from "@playwright/test";
import { test } from "../support/fixtures";
import { connectSeedClient } from "../support/helpers/seed-client";
import { createTempGitRepo } from "../support/helpers/workspace";
import { createIdleAgent, resetSeededPageState } from "../support/helpers/archive-tab";
import { gotoAppShell } from "../support/helpers/app";

for (const width of [390, 1440]) {
  test(`global Stream links conversations and resolves individual questions at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const repo = await createTempGitRepo("global-stream-");
    const client = await connectSeedClient();
    const created = await client.createWorkspace({
      source: { kind: "directory", path: repo.path },
    });
    if (!created.workspace) throw new Error(created.error ?? "Workspace missing");
    const workspace = created.workspace;
    try {
      const first = await createIdleAgent(client, {
        cwd: repo.path,
        workspaceId: workspace.id,
        title: "Stream alpha",
      });
      const second = await createIdleAgent(client, {
        cwd: repo.path,
        workspaceId: workspace.id,
        title: "Stream beta",
      });
      await client.updateStreamEntry({
        agentId: first.id,
        action: "add_question",
        entryId: "name",
        text: "Choose the launch name",
      });
      await client.updateStreamEntry({
        agentId: second.id,
        action: "add_question",
        entryId: "channel",
        text: "Choose the release channel",
      });
      await client.updateStreamEntry({
        agentId: first.id,
        action: "add_pin",
        text: "Remember the launch context",
      });
      await resetSeededPageState(page);
      await page.setViewportSize({ width, height: 900 });
      await gotoAppShell(page);
      await page.goto("/stream");
      await expect(page.getByText("Choose the launch name", { exact: true })).toBeVisible();
      await expect(page.getByText("Choose the release channel", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Needs a reply", exact: true }).click();
      await page
        .getByTestId(`global-stream-row-${first.id}`)
        .getByRole("button", { name: "Done", exact: true })
        .click();
      await expect(page.getByText("Choose the launch name", { exact: true })).toHaveCount(0);
      await expect(page.getByText("Choose the release channel", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Pinned", exact: true }).click();
      await expect(page.getByText("Remember the launch context", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Unpin", exact: true }).click();
      await expect(page.getByText("Remember the launch context", { exact: true })).toHaveCount(0);
      await client.updateStreamEntry({
        agentId: first.id,
        action: "add_pin",
        text: "A concurrently removed note",
      });
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await expect(page.getByText("A concurrently removed note", { exact: true })).toBeVisible();
      const pins = await client.listGlobalStream({ filter: "pinned" });
      const removed = pins.rows.find(
        (row) => row.item.kind === "entry" && row.item.entry.text === "A concurrently removed note",
      );
      if (!removed || removed.item.kind !== "entry") throw new Error("Seeded pin missing");
      await client.updateStreamEntry({
        agentId: first.id,
        action: "remove_pin",
        entryId: removed.item.entry.id,
      });
      await page.getByRole("button", { name: "Unpin", exact: true }).click();
      await expect(page.getByText("Pinned item no longer exists", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "All", exact: true }).click();
      await page.getByTestId("global-stream-search").fill("release channel");
      await expect(page.getByText("Choose the launch name", { exact: true })).toHaveCount(0);
      await expect(page.getByText("Choose the release channel", { exact: true })).toBeVisible();
      await page.screenshot({ path: `/tmp/paseo-global-stream-${width}.png`, fullPage: true });
      await page
        .getByTestId(`global-stream-row-${second.id}`)
        .getByRole("button", { name: /Stream beta/ })
        .click();
      await expect(page).toHaveURL(new RegExp(`/workspace/${workspace.id}`));
    } finally {
      await client.removeProject(workspace.projectId);
      await client.close();
      await repo.cleanup();
    }
  });
}
