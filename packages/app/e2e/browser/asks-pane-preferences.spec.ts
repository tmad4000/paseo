import { expect, test } from "../support/fixtures";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

// Real renderer, layout persistence and daemon: no mocked store or transport.
test("asks panes keep independent split choices across reload and show live compact ages", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "asks-pane-preferences-",
    title: "First pane",
  });
  try {
    const second = await agent.client.createAgent({
      provider: "mock",
      cwd: agent.cwd,
      workspaceId: agent.workspaceId,
      title: "Second pane",
      modeId: "load-test",
      model: "e2e-fast-stream",
    });
    for (const id of [agent.agentId, second.id]) {
      await agent.client.updateStreamEntry({
        agentId: id,
        action: "set_ask",
        entryId: "request",
        text: "Prepare release notes",
        expectedRevision: 0,
        ask: { state: "in_progress", evidence: "", remaining: "Collect merged changes" },
      });
      await agent.client.updateStreamEntry({
        agentId: id,
        action: "set_ask",
        entryId: "question",
        text: "Which database?",
        expectedRevision: 0,
        ask: { state: "open", evidence: "", remaining: "" },
      });
      await agent.client.updateStreamEntry({
        agentId: id,
        action: "set_reply",
        entryId: "ask:question",
        text: "Postgres 16.",
        replyRevision: 0,
      });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await openAgentRoute(page, agent);
    const panes = page.getByTestId("tracked-answers-pane").filter({ visible: true });
    await expect(panes).toHaveCount(1);
    await panes.first().getByTestId("tracked-answers-minimize").click();

    await page.getByTestId("workspace-split-pane-menu").first().click();
    await page.getByTestId("workspace-split-pane-right-with-session").click();
    const picker = page.getByTestId("view-session-picker");
    await picker.getByTestId("view-session-picker-search").fill(second.id.slice(0, 8));
    await picker.getByTestId(`view-session-picker-row-${second.id}`).click();
    await expect(panes).toHaveCount(2);
    // Closing the first pane must not close the second.
    await expect(panes.nth(0).getByTestId("tracked-answers-expand")).toBeVisible();
    await expect(panes.nth(1).getByTestId("tracked-answers-minimize")).toBeVisible();
    await page.reload();
    await expect(panes).toHaveCount(2);
    await expect(panes.nth(0).getByTestId("tracked-answers-expand")).toBeVisible();
    await expect(panes.nth(1).getByTestId("tracked-answers-minimize")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("independent-splits.png") });

    await panes.nth(0).getByTestId("tracked-answers-expand").click();
    await panes.nth(1).getByTestId("tracked-answers-minimize").click();
    await page.reload();
    await expect(panes.nth(0).getByTestId("tracked-answers-minimize")).toBeVisible();
    await expect(panes.nth(1).getByTestId("tracked-answers-expand")).toBeVisible();

    // Ask/question and answer each carry their own time, and the existing clock updates them.
    const rows = await agent.client.listGlobalStream({ agentId: agent.agentId, limit: 100 });
    const row = rows.rows.find(
      (candidate) => candidate.item.kind === "entry" && candidate.item.entry.id === "ask:question",
    );
    if (!row || row.item.kind !== "entry") throw new Error("Missing question fixture");
    const askedAt = Date.parse(row.item.entry.timestamp);
    await page.clock.install({ time: askedAt + 12.5 * 60_000 });
    await page.reload();
    const timestamps = panes.nth(0).getByTestId("pane-timestamp");
    await expect(timestamps).toHaveCount(3);
    for (const stamp of await timestamps.all()) await expect(stamp).toHaveText("12m");
    await page.clock.fastForward(3 * 60_000);
    for (const stamp of await timestamps.all()) await expect(stamp).toHaveText("15m");
    await page.screenshot({ path: testInfo.outputPath("compact-ages.png") });
  } finally {
    await agent.cleanup();
  }
});
