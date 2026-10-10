import { expect } from "@playwright/test";
import { test } from "../support/fixtures";
import { connectSeedClient } from "../support/helpers/seed-client";
import { createTempGitRepo } from "../support/helpers/workspace";
import { createIdleAgent, resetSeededPageState } from "../support/helpers/archive-tab";
import { gotoAppShell } from "../support/helpers/app";

for (const width of [390, 1440]) {
  test(`global Stream links conversations and resolves individual questions at ${width}px`, async ({
    page,
  }, testInfo) => {
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
      await page.screenshot({ path: testInfo.outputPath("global-stream-all.png"), fullPage: true });
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
      await page.screenshot({
        path: testInfo.outputPath("global-stream-rejected-write.png"),
        fullPage: true,
      });
      await page.getByRole("button", { name: "All", exact: true }).click();
      await page.getByTestId("global-stream-search").fill("release channel");
      await expect(page.getByText("Choose the launch name", { exact: true })).toHaveCount(0);
      await expect(page.getByText("Choose the release channel", { exact: true })).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath("global-stream-search.png"),
        fullPage: true,
      });
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

test("durable checklist pages, evidence and reopen survive reconnect", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const repo = await createTempGitRepo("durable-stream-");
  const client = await connectSeedClient();
  const created = await client.createWorkspace({ source: { kind: "directory", path: repo.path } });
  if (!created.workspace) throw new Error(created.error ?? "Workspace missing");
  const workspace = created.workspace;
  try {
    const agent = await createIdleAgent(client, {
      cwd: repo.path,
      workspaceId: workspace.id,
      title: "Durable checklist",
    });
    for (let i = 0; i < 53; i++)
      await client.updateStreamEntry({
        agentId: agent.id,
        action: "set_ask",
        entryId: `ask-${i}`,
        expectedRevision: 0,
        text: `Deliver request ${i}`,
        ask: {
          state: i === 0 ? "blocked" : "done",
          remaining: i === 0 ? "Waiting for acceptance" : "",
          evidence: i === 0 ? "Implementation tested" : "Acceptance recorded",
        },
      });
    await resetSeededPageState(page);
    await page.setViewportSize({ width: 390, height: 900 });
    await gotoAppShell(page);
    await page.goto("/stream");
    await page
      .getByTestId(`global-stream-row-${agent.id}`)
      .first()
      .getByRole("button", { name: /Durable checklist/ })
      .click();
    await page.getByTestId("agent-view-artifacts").click();
    const feed = page.getByTestId("companion-stream");
    await feed.getByRole("button", { name: "Checklist", exact: true }).click();
    await feed.getByTestId("stream-status-filter").getByRole("button", { name: /^Open/ }).click();
    await expect(feed.getByText("Deliver request 0", { exact: true })).toBeVisible();
    await expect(feed.getByText("Blocked", { exact: true })).toBeVisible();
    await expect(
      feed.getByText("Remaining: Waiting for acceptance", { exact: true }),
    ).toBeVisible();
    await expect(feed.getByRole("button", { name: "Done", exact: true })).toBeDisabled();
    await page.screenshot({
      path: testInfo.outputPath("durable-checklist-phone.png"),
      fullPage: true,
    });
    await feed.getByTestId("stream-status-filter").getByRole("button", { name: /^All/ }).click();
    await expect(feed.getByRole("button", { name: "Load more" })).toBeVisible();
    await feed.getByRole("button", { name: "Load more" }).click();
    await expect(feed.getByRole("button", { name: "Load more" })).toHaveCount(0);
    const completed = feed.getByTestId("companion-entry-ask:ask-1");
    // FlatList may mount then evict a row while correcting estimated heights.
    // Move incrementally until the row mounts, then center it synchronously in
    // the browser. Retry the viewport assertion if height correction evicts it.
    await expect(async () => {
      await feed.evaluate((element) => {
        const target = element.querySelector('[data-testid="companion-entry-ask:ask-1"]');
        if (target) target.scrollIntoView({ block: "center", behavior: "instant" });
        else element.scrollBy({ top: element.clientHeight * 0.5 });
      });
      await expect(completed).toBeInViewport({ timeout: 1_000 });
    }).toPass({ timeout: 30_000, intervals: [500] });
    await expect(
      completed.getByText("Completion evidence: Acceptance recorded", { exact: true }),
    ).toBeVisible();
    await completed.getByRole("button", { name: "Open", exact: true }).click();
    await expect(completed.getByText("Open", { exact: true }).first()).toBeVisible();
    await page.reload();
    await feed.getByRole("button", { name: "Checklist", exact: true }).click();
    await feed.getByTestId("stream-status-filter").getByRole("button", { name: /^Open/ }).click();
    await expect(page.getByTestId("companion-entry-ask:ask-1")).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({
      path: testInfo.outputPath("durable-checklist-desktop.png"),
      fullPage: true,
    });
    const pending = await client.listGlobalStream({
      agentId: agent.id,
      asksOnly: true,
      filter: "pending",
    });
    expect(pending.rows).toHaveLength(2);
  } finally {
    await client.removeProject(workspace.projectId);
    await client.close();
    await repo.cleanup();
  }
});

test("closed activity shows hidden counts, clear filters and a reloadable copied Stream link", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const repo = await createTempGitRepo("stream-filter-empty-");
  const client = await connectSeedClient();
  const created = await client.createWorkspace({ source: { kind: "directory", path: repo.path } });
  if (!created.workspace) throw new Error(created.error ?? "Workspace missing");
  const workspace = created.workspace;
  try {
    const agent = await createIdleAgent(client, {
      cwd: repo.path,
      workspaceId: workspace.id,
      title: "Closed activity example",
    });
    for (let i = 0; i < 10; i++)
      await client.updateStreamEntry({
        agentId: agent.id,
        action: "add_question",
        entryId: `closed-${i}`,
        text: `Reviewed item ${i}`,
        status: "done",
      });
    await resetSeededPageState(page);
    await page.setViewportSize({ width: 390, height: 900 });
    await gotoAppShell(page);
    await page.goto("/stream");
    await page
      .getByTestId(`global-stream-row-${agent.id}`)
      .first()
      .getByRole("button", { name: /Closed activity example/ })
      .click();
    await page.getByTestId("agent-view-artifacts").click();
    const feed = page.getByTestId("companion-stream");
    await expect(feed.getByText(/0 open; 10 other items/)).toBeVisible();
    await feed.getByTestId("stream-status-filter").getByRole("button", { name: /^Open/ }).click();
    await expect(feed.getByText("No items match these filters", { exact: true })).toBeVisible();
    await expect(feed.getByText(/0 open; 10 other items/)).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("stream-filter-empty-phone.png"),
      fullPage: true,
    });
    await feed.getByRole("button", { name: "Show all items", exact: true }).click();
    await expect(feed.getByText("Reviewed item 9", { exact: true })).toBeVisible();
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await feed.getByRole("button", { name: "Copy Stream link", exact: true }).click();
    await expect(feed.getByText("Stream link copied", { exact: true })).toBeVisible();
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toContain(`/agent/${agent.id}?view=stream`);
    await page.goto(link);
    await expect(page.getByTestId("companion-stream")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("companion-stream")).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({
      path: testInfo.outputPath("stream-activity-desktop.png"),
      fullPage: true,
    });
  } finally {
    await client.removeProject(workspace.projectId);
    await client.close();
    await repo.cleanup();
  }
});

test("retained user messages expose multiple asks without confusing agent questions or completion", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const repo = await createTempGitRepo("stream-message-review-");
  const client = await connectSeedClient();
  const created = await client.createWorkspace({ source: { kind: "directory", path: repo.path } });
  if (!created.workspace) throw new Error(created.error ?? "Workspace missing");
  const workspace = created.workspace;
  try {
    const agent = await client.createAgent({
      provider: "mock",
      model: "e2e-fast-stream",
      modeId: "load-test",
      cwd: repo.path,
      workspaceId: workspace.id,
      title: "Message inventory",
      featureValues: { mockAssistantResponse: "Should I start deployment?" },
    });
    await client.waitForAgentUpsert(agent.id, (snapshot) => snapshot.status === "idle");
    await client.sendAgentMessage(agent.id, "Fix filtering and add direct links.");
    await client.waitForFinish(agent.id);
    const inventory = await client.listGlobalStream({
      agentId: agent.id,
      includeMessageInventory: true,
      asksOnly: true,
    });
    const source = inventory.rows.find(
      (row) => row.item.kind === "entry" && row.item.entry.messageReview,
    );
    if (!source || source.item.kind !== "entry") throw new Error("Source message not captured");
    const sourceMessageId = source.item.entry.source!.messageId;
    await resetSeededPageState(page);
    await gotoAppShell(page);
    await page.goto("/stream");
    await page
      .getByTestId(`global-stream-row-${agent.id}`)
      .first()
      .getByRole("button", { name: /Message inventory/ })
      .click();
    await page.getByTestId("agent-view-artifacts").click();
    const feed = page.getByTestId("companion-stream");
    await feed
      .getByTestId("stream-source-filter")
      .getByRole("button", { name: "Your messages", exact: true })
      .click();
    await expect(
      feed.getByText("Fix filtering and add direct links.", { exact: true }),
    ).toBeVisible();
    await expect(feed.getByText("Should I start deployment?", { exact: true })).toHaveCount(0);
    await feed
      .getByTestId("stream-source-filter")
      .getByRole("button", { name: "Agent messages", exact: true })
      .click();
    await expect(
      feed.getByText("Fix filtering and add direct links.", { exact: true }),
    ).toHaveCount(0);
    await expect(
      feed.getByText("Should I start deployment?", { exact: true }).first(),
    ).toBeVisible();
    await feed.getByRole("button", { name: "Clear filters", exact: true }).click();
    await feed.getByRole("button", { name: "Checklist", exact: true }).click();
    await expect(feed.getByText("Needs ask review", { exact: true })).toBeVisible();
    for (const id of ["filters", "links"])
      await client.updateStreamEntry({
        agentId: agent.id,
        action: "set_ask",
        entryId: id,
        expectedRevision: 0,
        text: id === "filters" ? "Fix filtering" : "Add direct links",
        ask: {
          state: id === "filters" ? "done" : "blocked",
          remaining: id === "filters" ? "" : "Review pending",
          evidence: id === "filters" ? "Filter regression passed" : "",
          sourceMessageId,
        },
      });
    await client.updateStreamEntry({
      agentId: agent.id,
      action: "review_message",
      entryId: source.item.entry.id,
      expectedRevision: 0,
      review: {
        state: "reviewed",
        note: "Two asks recorded, links still blocked",
        askIds: ["filters", "links"],
      },
    });
    await feed.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(feed.getByText("Needs ask review", { exact: true })).toHaveCount(0);
    await expect(feed.getByText("Blocked", { exact: true })).toBeVisible();
    await expect(
      feed.getByText("Completion evidence: Filter regression passed", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("stream-multiple-asks.png"),
      fullPage: true,
    });
    await feed
      .getByRole("button", { name: "Open source message in Chat", exact: true })
      .first()
      .click();
    await expect(page.getByTestId("companion-stream")).toHaveCount(0);
    await expect(
      page.getByText("Fix filtering and add direct links.", { exact: true }),
    ).toBeVisible();
  } finally {
    await client.removeProject(workspace.projectId);
    await client.close();
    await repo.cleanup();
  }
});
