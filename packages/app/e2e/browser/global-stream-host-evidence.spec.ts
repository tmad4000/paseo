import { test, expect } from "../support/fixtures";
import { connectSeedClient, type SeedDaemonClient } from "../support/helpers/seed-client";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { startIsolatedHostDaemon } from "../support/helpers/isolated-host-daemon";
import { addConnectedHostAndReload } from "../support/helpers/hosts";
import { createTempGitRepo } from "../support/helpers/workspace";
import { createIdleAgent } from "../support/helpers/archive-tab";
import { gotoAppShell } from "../support/helpers/app";

test("paired Stream combines hosts, filters and retains offline cards", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const repo = await createTempGitRepo("stream-host-evidence-");
  const secondary = await startIsolatedHostDaemon("stream-evidence-secondary");
  const primaryClient = await connectSeedClient();
  const secondaryClient = await connectDaemonClient<SeedDaemonClient>({
    clientIdPrefix: "stream-evidence",
    port: secondary.port,
  });
  const projects: Array<{ client: SeedDaemonClient; projectId: string }> = [];
  try {
    for (const [client, title, text] of [
      [primaryClient, "Primary review", "Choose primary launch"],
      [secondaryClient, "Secondary review", "Choose secondary launch"],
    ] as const) {
      const created = await client.createWorkspace({
        source: { kind: "directory", path: repo.path },
      });
      if (!created.workspace) throw new Error(created.error ?? "Missing workspace");
      projects.push({ client, projectId: created.workspace.projectId });
      const agent = await createIdleAgent(client, {
        cwd: repo.path,
        workspaceId: created.workspace.id,
        title,
      });
      await client.updateStreamEntry({
        agentId: agent.id,
        action: "add_question",
        entryId: "launch",
        text,
      });
    }
    await gotoAppShell(page);
    await page.goto("/stream");
    await addConnectedHostAndReload(page, {
      serverId: secondary.serverId,
      label: "Secondary review host",
      port: secondary.port,
    });
    await expect(page.getByText("Choose primary launch", { exact: true })).toBeVisible();
    await expect(page.getByText("Choose secondary launch", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("paired-hosts.png"), fullPage: true });
    await page.getByTestId("global-stream-host").click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Secondary review host", exact: true })
      .click();
    await expect(page.getByText("Choose primary launch", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Choose secondary launch", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("host-filter.png"), fullPage: true });
    await secondary.close();
    await expect(
      page.getByText("Secondary review host: offline — cached items may be out of date", {
        exact: true,
      }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Choose secondary launch", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Done", exact: true })).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath("offline-cache.png"), fullPage: true });
  } finally {
    for (const project of projects) {
      if (project.client === primaryClient) await project.client.removeProject(project.projectId);
    }
    await Promise.all([primaryClient.close(), secondaryClient.close()]);
    await secondary.close();
    await repo.cleanup();
  }
});
