import { expect } from "@playwright/test";
import { test } from "../support/fixtures";
import { connectSeedClient } from "../support/helpers/seed-client";
import { createTempGitRepo } from "../support/helpers/workspace";
import { createIdleAgent, resetSeededPageState } from "../support/helpers/archive-tab";
import { gotoAppShell } from "../support/helpers/app";

for (const width of [390, 1440]) {
  test(`Stream tags: cloud, filter, pinned tags, hashtag links and tagged notes at ${width}px`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    // Tags are unique per run: both widths share one isolated daemon and its host-wide pins.
    const [design, ux, quotes, launch] = ["design", "ux", "quotes", "launch"].map(
      (name) => `${name}-${width}`,
    );
    const quoteText = `Constraints are the material of good design. #${design} #${quotes}`;
    const repo = await createTempGitRepo("stream-tags-");
    const client = await connectSeedClient();
    const created = await client.createWorkspace({
      source: { kind: "directory", path: repo.path },
    });
    if (!created.workspace) throw new Error(created.error ?? "Workspace missing");
    const workspace = created.workspace;
    try {
      const agent = await createIdleAgent(client, {
        cwd: repo.path,
        workspaceId: workspace.id,
        title: "Tagged chat",
      });
      const other = await createIdleAgent(client, {
        cwd: repo.path,
        workspaceId: workspace.id,
        title: "Other tagged chat",
      });
      const pin = (agentId: string, entryId: string, text: string, sourceId?: string) =>
        client.updateStreamEntry({ agentId, action: "add_pin", entryId, text, sourceId });
      await pin(agent.id, "cloud", `Ship the tag cloud first\nThen the filters. #${design} #${ux}`);
      await pin(agent.id, "quote", quoteText, "msg:seeded-source");
      await pin(agent.id, "plain", "An untagged note");
      await pin(other.id, "elsewhere", `Same tag in another chat #${design}`);

      await resetSeededPageState(page);
      await page.setViewportSize({ width, height: 950 });
      await gotoAppShell(page);
      await page.goto("/stream");

      // Global cloud: counts span chats; tapping a chip filters to entries carrying it.
      const designChip = page.getByTestId("stream-tag-cloud").getByTestId(`stream-tag-${design}`);
      await expect(designChip).toHaveAccessibleName(`#${design}, 3 items`);
      await designChip.click();
      await expect(page.getByTestId("stream-tag-filters")).toContainText(`#${design}`);
      await expect(
        page
          .getByTestId(`global-stream-row-${agent.id}`)
          .getByText("An untagged note", { exact: true }),
      ).toHaveCount(0);
      await expect(page.getByText(`Same tag in another chat #${design}`)).toBeVisible();

      // Pin from the active filter chip; the cloud marks it pinned and the host keeps it.
      await page.getByRole("button", { name: `Pin #${design}`, exact: true }).click();
      await expect(designChip).toHaveAccessibleName(`Pinned tag #${design}, 3 items`);
      expect((await client.listGlobalStream({})).pinnedTags).toContain(design);
      await page.getByRole("button", { name: `Remove #${design} filter`, exact: true }).click();
      await expect(
        page
          .getByTestId(`global-stream-row-${agent.id}`)
          .getByText("An untagged note", { exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`global-stream-tags-${width}.png`),
        fullPage: true,
      });

      // Per-chat: the quote card, and a hashtag in card text sets the filter.
      await page
        .getByTestId(`global-stream-row-${agent.id}`)
        .first()
        .getByRole("button", { name: /Tagged chat/ })
        .click();
      await page.getByTestId("agent-view-artifacts").click();
      const feed = page.getByTestId("local-stream-workflow");
      const cloud = feed.getByTestId("stream-tag-cloud");
      await expect(cloud.getByTestId(`stream-tag-${ux}`)).toBeVisible();
      await expect(feed.getByTestId("companion-entry-quote")).toHaveText(quoteText);
      await expect(feed.getByTestId("companion-entry-pin:quote")).toContainText("Show in chat");
      await feed.getByTestId("companion-entry-pin:quote").scrollIntoViewIfNeeded();
      await feed
        .getByTestId("companion-entry-pin:quote")
        .screenshot({ path: testInfo.outputPath(`quote-card-${width}.png`) });
      await feed
        .getByTestId("companion-entry-pin:cloud")
        .getByTestId(`stream-hashtag-${ux}`)
        .click();
      await expect(feed.getByTestId("stream-tag-filters")).toContainText(`#${ux}`);
      await expect(feed.getByText("An untagged note", { exact: true })).toHaveCount(0);
      await expect(feed.getByText("Ship the tag cloud first", { exact: true })).toBeVisible();
      await feed.getByRole("button", { name: `Pin #${ux}`, exact: true }).click();
      await expect
        .poll(async () => (await client.listGlobalStream({ agentId: agent.id })).pinnedTags)
        .toEqual([ux]);
      await feed.getByRole("button", { name: `Remove #${ux} filter`, exact: true }).click();

      // The note composer appends chosen tags; suggestions come from existing host tags.
      await feed.getByRole("button", { name: "Saved", exact: true }).click();
      await feed.getByTestId("stream-saved-input").fill("Remember the launch window");
      const tagInput = feed
        .getByTestId("companion-stream-note-tags-input")
        .filter({ visible: true });
      await tagInput.fill(launch);
      await tagInput.press("Enter");
      await feed.getByTestId(`stream-tag-suggestion-${quotes}`).filter({ visible: true }).click();
      await feed.getByRole("button", { name: "Add note", exact: true }).click();
      await expect
        .poll(async () => {
          const tagged = await client.listGlobalStream({ agentId: agent.id, tags: [launch] });
          return tagged.rows.map((row) => (row.item.kind === "entry" ? row.item.entry.text : ""));
        })
        .toEqual([`Remember the launch window\n\n#${launch} #${quotes}`]);
      await expect(cloud.getByTestId(`stream-tag-${launch}`)).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`chat-stream-tags-${width}.png`),
        fullPage: true,
      });
    } finally {
      await client.removeProject(workspace.projectId);
      await client.close();
      await repo.cleanup();
    }
  });
}
