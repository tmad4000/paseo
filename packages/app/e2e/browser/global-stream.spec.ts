import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { expect } from "@playwright/test";
import { test } from "../support/fixtures";
import { overrideServerInfoFeatures } from "../support/helpers/server-info-features";
import { connectSeedClient } from "../support/helpers/seed-client";
import { createTempGitRepo } from "../support/helpers/workspace";
import { createIdleAgent, resetSeededPageState } from "../support/helpers/archive-tab";
import { gotoAppShell } from "../support/helpers/app";

for (const width of [390, 1440]) {
  test(`chat pins messages, items and excerpts with visible retry at ${width}px`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    page.setDefaultTimeout(15_000);
    let rejectNextPin = false;
    const pinIds: string[] = [];
    await page.routeWebSocket(daemonWsRoutePattern(), (browser) => {
      const server = browser.connectToServer();
      browser.onMessage((message) => {
        if (typeof message === "string") {
          const envelope = JSON.parse(message);
          const request = envelope.type === "session" ? envelope.message : null;
          if (request?.type === "stream.entry.update.request" && request.action === "add_pin") {
            pinIds.push(request.entryId);
            if (rejectNextPin) {
              rejectNextPin = false;
              browser.send(
                JSON.stringify({
                  type: "session",
                  message: {
                    type: "rpc_error",
                    payload: {
                      requestId: request.requestId,
                      requestType: request.type,
                      error: "Pin save failed. Please retry.",
                      code: "handler_error",
                    },
                  },
                }),
              );
              return;
            }
          }
        }
        server.send(message);
      });
      server.onMessage((message) => browser.send(message));
    });
    const response =
      "A completed reply remains in Stream.\n\nKeep this exact line.\n\nAnother useful detail.";
    const session = await seedMockAgentWorkspace({
      repoPrefix: "chat-stream-pins-",
      title: "Chat Stream pins",
      initialPrompt: "Return a completed reply for pinning.",
      featureValues: { mockAssistantResponse: response },
    });
    try {
      await page.setViewportSize({ width, height: 950 });
      await openAgentRoute(page, session);
      await session.client.waitForFinish(session.agentId, 45_000);
      await page.getByTestId("agent-view-artifacts").click();
      await expect(
        page.getByTestId("companion-stream").getByText("Turn ended", { exact: true }),
      ).toBeVisible();
      await page.getByTestId("agent-view-chat").click();
      const pin = page.getByRole("button", { name: "Pin to stream", exact: true });
      await expect(pin.last()).toBeVisible();
      await pin.last().click();
      await page.getByText("Pin message to Stream", { exact: true }).click();
      await expect(page.getByText("Saved to Stream", { exact: true })).toBeVisible();
      const fullPins = await session.client.listGlobalStream({
        agentId: session.agentId,
        filter: "pinned",
      });
      expect(
        fullPins.rows.map((row) => (row.item.kind === "entry" ? row.item.entry.text : "")),
      ).toEqual([response]);

      await pin.last().click();
      await page.getByText("Pin excerpt…", { exact: true }).click();
      const excerpt = page.getByTestId("message-pin-excerpt-body");
      await excerpt.getByTestId("message-pin-excerpt-input").fill("Keep this exact line.");
      rejectNextPin = true;
      await excerpt.getByRole("button", { name: "Pin to stream", exact: true }).click();
      await expect(excerpt.getByRole("alert")).toHaveText("Pin save failed. Please retry.");
      await expect(excerpt.getByTestId("message-pin-excerpt-input")).toHaveValue(
        "Keep this exact line.",
      );
      await page.screenshot({
        path: testInfo.outputPath(`pin-retry-${width}.png`),
        fullPage: true,
      });
      await excerpt.getByRole("button", { name: "Pin to stream", exact: true }).click();
      await expect(excerpt).toHaveCount(0);
      expect(pinIds[1]).toBe(pinIds[2]);

      // An individual Markdown block is independently pinnable through its context menu.
      await page
        .getByTestId("assistant-message")
        .filter({ hasText: "Another useful detail." })
        .click({ button: "right" });
      await page.getByText("Pin message to Stream", { exact: true }).click();
      await expect
        .poll(
          async () =>
            (await session.client.listGlobalStream({ agentId: session.agentId, filter: "pinned" }))
              .rows.length,
        )
        .toBe(3);
      await expect(page.getByText("Pin message to Stream", { exact: true })).toHaveCount(0);

      const selectedItem = page
        .getByTestId("assistant-message")
        .filter({ hasText: "Keep this exact line." });
      const selectionPoint = await selectedItem.evaluate((element) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          const index = node.textContent?.indexOf("exact") ?? -1;
          if (index < 0) continue;
          const range = document.createRange();
          range.setStart(node, index);
          range.setEnd(node, index + 5);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          const rect = range.getBoundingClientRect();
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        }
        throw new Error("Expected selectable excerpt");
      });
      await page.mouse.click(selectionPoint.x, selectionPoint.y, { button: "right" });
      await page.getByText("Pin selected text to Stream", { exact: true }).click();
      await expect
        .poll(async () => {
          const pins = await session.client.listGlobalStream({
            agentId: session.agentId,
            filter: "pinned",
          });
          return pins.rows.some(
            (row) =>
              row.item.kind === "entry" &&
              row.item.entry.kind === "pin" &&
              row.item.entry.text === "exact" &&
              row.item.entry.sourceId?.startsWith("msg:"),
          );
        })
        .toBe(true);
      await expect(page.getByText("Pin message to Stream", { exact: true })).toHaveCount(0);

      // User-message pinning uses the same acknowledged path.
      await page
        .getByTestId("user-message")
        .getByText("Return a completed reply for pinning.", { exact: true })
        .hover();
      await pin.first().click();
      await page.getByText("Pin message to Stream", { exact: true }).click();
      await expect
        .poll(
          async () =>
            (await session.client.listGlobalStream({ agentId: session.agentId, filter: "pinned" }))
              .rows.length,
        )
        .toBe(5);
      await expect(page.getByText("Pin message to Stream", { exact: true })).toHaveCount(0);

      // The default Activity view includes completed outcomes and newly saved pins.
      await page.getByTestId("agent-view-artifacts").click();
      const feed = page.getByTestId("companion-stream");
      await expect(feed.getByText("Keep this exact line.", { exact: true })).toBeVisible();
      await expect(feed.getByText("Another useful detail.", { exact: true })).toBeVisible();
      await feed.getByRole("button", { name: "Checklist", exact: true }).click();
      await expect(
        feed.getByText(
          "Checklist contains requests your agent explicitly tracks. Captured replies and pins are in Activity.",
        ),
      ).toBeVisible();
      await feed.getByRole("button", { name: "Show activity", exact: true }).click();
      await page.screenshot({
        path: testInfo.outputPath(`stream-activity-${width}.png`),
        fullPage: true,
      });
      await page.reload();
      await page.getByTestId("agent-view-artifacts").click();
      await page
        .getByTestId("companion-stream")
        .getByRole("button", { name: "Pinned", exact: true })
        .click();
      await expect(
        page.getByTestId("companion-stream").getByText("Keep this exact line.", { exact: true }),
      ).toBeVisible();
    } finally {
      await session.cleanup();
    }
  });
}

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
    await feed.getByRole("button", { name: "Show unresolved only", exact: true }).click();
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
    await feed.getByRole("button", { name: "Show completed too" }).click();
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
    await page.getByTestId("agent-view-artifacts").click();
    await page
      .getByTestId("companion-stream")
      .getByRole("button", { name: "Checklist", exact: true })
      .click();
    await page
      .getByTestId("companion-stream")
      .getByRole("button", { name: "Show unresolved only", exact: true })
      .click();
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

test("per-chat Stream on an older host shows the chat's recent entries instead of blocking", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const repo = await createTempGitRepo("older-host-stream-");
  const client = await connectSeedClient();
  const created = await client.createWorkspace({ source: { kind: "directory", path: repo.path } });
  if (!created.workspace) throw new Error(created.error ?? "Workspace missing");
  const workspace = created.workspace;
  try {
    const agent = await createIdleAgent(client, {
      cwd: repo.path,
      workspaceId: workspace.id,
      title: "Older host Stream",
    });
    await client.updateStreamEntry({
      agentId: agent.id,
      action: "add_question",
      entryId: "older-host-question",
      text: "Which host runs this chat?",
    });
    await resetSeededPageState(page);
    await overrideServerInfoFeatures(page, { durableStream: false });
    await gotoAppShell(page);
    await page.goto("/stream");
    await page
      .getByTestId(`global-stream-row-${agent.id}`)
      .first()
      .getByRole("button", { name: /Older host Stream/ })
      .click();
    await page.getByTestId("agent-view-artifacts").click();
    const feed = page.getByTestId("companion-stream");
    await expect(feed.getByTestId("companion-stream-older-host")).toContainText("runs Paseo");
    await expect(page.getByTestId("companion-stream-unsupported")).toHaveCount(0);
    await feed.getByRole("button", { name: "Queue", exact: true }).click();
    await expect(feed.getByText("Which host runs this chat?", { exact: true })).toBeVisible();
  } finally {
    await client.removeProject(workspace.projectId);
    await client.close();
    await repo.cleanup();
  }
});
