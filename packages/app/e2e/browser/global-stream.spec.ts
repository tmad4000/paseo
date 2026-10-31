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
        page
          .getByTestId("local-stream-workflow")
          .getByText(/^Turn ended · /)
          .first(),
      ).toBeVisible();
      await page.getByTestId("agent-view-chat").click();
      const pin = page.getByRole("button", { name: "Save to Stream", exact: true });
      await expect(pin.last()).toBeVisible();
      await pin.last().click();
      await page.getByText("Save message to Stream", { exact: true }).click();
      await expect(page.getByText("Saved to Stream", { exact: true })).toBeVisible();
      const fullPins = await session.client.listGlobalStream({
        agentId: session.agentId,
        filter: "pinned",
      });
      expect(
        fullPins.rows.map((row) => (row.item.kind === "entry" ? row.item.entry.text : "")),
      ).toEqual([response]);

      await pin.last().click();
      await page.getByText("Save excerpt…", { exact: true }).click();
      const excerpt = page.getByTestId("message-pin-excerpt-body");
      await excerpt.getByTestId("message-pin-excerpt-input").fill("Keep this exact line.");
      rejectNextPin = true;
      await excerpt.getByRole("button", { name: "Save to Stream", exact: true }).click();
      await expect(excerpt.getByRole("alert")).toHaveText("Pin save failed. Please retry.");
      await expect(excerpt.getByTestId("message-pin-excerpt-input")).toHaveValue(
        "Keep this exact line.",
      );
      await page.screenshot({
        path: testInfo.outputPath(`pin-retry-${width}.png`),
        fullPage: true,
      });
      await excerpt.getByRole("button", { name: "Save to Stream", exact: true }).click();
      await expect(excerpt).toHaveCount(0);
      expect(pinIds[1]).toBe(pinIds[2]);

      // An individual Markdown block is independently pinnable through its context menu.
      await page
        .getByTestId("assistant-message")
        .filter({ hasText: "Another useful detail." })
        .click({ button: "right" });
      await page.getByText("Save message to Stream", { exact: true }).click();
      await expect
        .poll(
          async () =>
            (await session.client.listGlobalStream({ agentId: session.agentId, filter: "pinned" }))
              .rows.length,
        )
        .toBe(3);
      await expect(page.getByText("Save message to Stream", { exact: true })).toHaveCount(0);

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
      await page.getByText("Save selected text to Stream", { exact: true }).click();
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
      await expect(page.getByText("Save message to Stream", { exact: true })).toHaveCount(0);

      // User-message pinning uses the same acknowledged path.
      await page
        .getByTestId("user-message")
        .getByText("Return a completed reply for pinning.", { exact: true })
        .hover();
      await pin.first().click();
      await page.getByText("Save message to Stream", { exact: true }).click();
      await expect
        .poll(
          async () =>
            (await session.client.listGlobalStream({ agentId: session.agentId, filter: "pinned" }))
              .rows.length,
        )
        .toBe(5);
      await expect(page.getByText("Save message to Stream", { exact: true })).toHaveCount(0);

      // The default Activity view includes completed outcomes and newly saved pins.
      await page.getByTestId("agent-view-artifacts").click();
      const feed = page.getByTestId("local-stream-workflow");
      await expect(feed.getByText("Keep this exact line.", { exact: true })).toBeVisible();
      await expect(feed.getByText("Another useful detail.", { exact: true })).toBeVisible();
      await feed.getByRole("button", { name: "Tasks", exact: true }).click();
      await expect(feed.getByText("No items match this view.", { exact: true })).toBeVisible();
      await expect(feed.getByText("Keep this exact line.", { exact: true })).toHaveCount(0);
      await feed.getByRole("button", { name: "Activity", exact: true }).click();
      await page.screenshot({
        path: testInfo.outputPath(`stream-activity-${width}.png`),
        fullPage: true,
      });
      await page.reload();
      await page.getByTestId("agent-view-artifacts").click();
      await page
        .getByTestId("local-stream-workflow")
        .getByRole("button", { name: "Saved", exact: true })
        .click();
      await expect(
        page
          .getByTestId("local-stream-workflow")
          .getByText("Keep this exact line.", { exact: true }),
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
      const firstRows = page.getByTestId(`global-stream-row-${first.id}`);
      const secondRows = page.getByTestId(`global-stream-row-${second.id}`);
      await resetSeededPageState(page);
      await page.setViewportSize({ width, height: 900 });
      await gotoAppShell(page);
      await page.goto("/stream");
      await expect(firstRows.getByText("Choose the launch name", { exact: true })).toBeVisible();
      await expect(
        secondRows.getByText("Choose the release channel", { exact: true }),
      ).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("global-stream-all.png"), fullPage: true });
      await page.getByTestId("global-stream").getByTestId("stream-needs-you").click();
      await page
        .getByTestId(`global-stream-row-${first.id}`)
        .getByRole("button", { name: "Done", exact: true })
        .click();
      await expect(firstRows.getByText("Choose the launch name", { exact: true })).toHaveCount(0);
      await expect(
        secondRows.getByText("Choose the release channel", { exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Saved", exact: true }).click();
      await expect(
        firstRows.getByText("Remember the launch context", { exact: true }),
      ).toBeVisible();
      await firstRows.getByRole("button", { name: "Unpin", exact: true }).click();
      await expect(firstRows.getByText("Remember the launch context", { exact: true })).toHaveCount(
        0,
      );
      await client.updateStreamEntry({
        agentId: first.id,
        action: "add_pin",
        text: "A concurrently removed note",
      });
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await expect(
        firstRows.getByText("A concurrently removed note", { exact: true }),
      ).toBeVisible();
      const pins = await client.listGlobalStream({ agentId: first.id, filter: "pinned" });
      const removed = pins.rows.find(
        (row) => row.item.kind === "entry" && row.item.entry.text === "A concurrently removed note",
      );
      if (!removed || removed.item.kind !== "entry") throw new Error("Seeded pin missing");
      await client.updateStreamEntry({
        agentId: first.id,
        action: "remove_pin",
        entryId: removed.item.entry.id,
      });
      await firstRows.getByRole("button", { name: "Unpin", exact: true }).click();
      await expect(
        firstRows.getByText("Pinned item no longer exists", { exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath("global-stream-rejected-write.png"),
        fullPage: true,
      });
      await page.getByRole("button", { name: "Activity", exact: true }).click();
      await page.getByTestId("global-stream-search").fill("release channel");
      await expect(firstRows.getByText("Choose the launch name", { exact: true })).toHaveCount(0);
      await expect(
        secondRows.getByText("Choose the release channel", { exact: true }),
      ).toBeVisible();
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

test("durable tasks page current work first, and evidence and reopen survive reconnect", async ({
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
    const feed = page.getByTestId("local-stream-workflow");
    await feed.getByRole("button", { name: "Tasks", exact: true }).click();
    await feed.getByRole("button", { name: "Show unresolved only", exact: true }).click();
    await expect(feed.getByText("Deliver request 0", { exact: true })).toBeVisible();
    const blocked = feed.getByTestId("companion-entry-ask:ask-0");
    // Kind and state share one muted eyebrow; the ask text is the headline.
    await expect(blocked.getByTestId("companion-entry-eyebrow")).toContainText("Ask · Blocked · ");
    await expect(blocked.getByTestId("companion-entry-eyebrow")).not.toContainText("explicit");
    await blocked.getByRole("button", { name: "Read", exact: true }).click();
    await expect(
      blocked.getByText("Remaining: Waiting for acceptance", { exact: true }),
    ).toBeVisible();
    await expect(blocked.getByRole("button", { name: "Done", exact: true })).toBeDisabled();
    await page.screenshot({
      path: testInfo.outputPath("durable-checklist-phone.png"),
      fullPage: true,
    });
    await feed.getByRole("button", { name: "Show completed too", exact: true }).click();
    // Tasks includes completed history, with current work first; pagination still loads every record.
    await expect(feed.getByTestId("stream-loaded-count")).toHaveText(
      "50 items loaded · more available",
    );
    await expect(feed.getByTestId(`global-stream-row-${agent.id}`).first()).toContainText(
      "Deliver request 0",
    );
    await expect(feed.getByRole("button", { name: "Load more" })).toBeVisible();
    await feed.getByRole("button", { name: "Load more" }).click();
    await expect(feed.getByRole("button", { name: "Load more" })).toHaveCount(0);
    await expect(feed.getByTestId("stream-loaded-count")).toHaveText("53 items loaded");
    const completed = feed.getByTestId("companion-entry-ask:ask-1");
    // FlatList may mount then evict a row while correcting estimated heights.
    // Move incrementally until the row mounts, then center it synchronously in
    // the browser. Retry the viewport assertion if height correction evicts it.
    await expect(async () => {
      await feed.evaluate((element) => {
        const target = element.querySelector('[data-testid="companion-entry-ask:ask-1"]');
        if (target) target.scrollIntoView({ block: "center", behavior: "instant" });
        else {
          for (const candidate of element.querySelectorAll<HTMLElement>("div")) {
            if (
              candidate.scrollHeight > candidate.clientHeight &&
              ["auto", "scroll"].includes(getComputedStyle(candidate).overflowY)
            ) {
              candidate.scrollBy({ top: candidate.clientHeight * 0.5 });
              break;
            }
          }
        }
      });
      await expect(completed).toBeInViewport({ timeout: 1_000 });
    }).toPass({ timeout: 30_000, intervals: [500] });
    await completed.getByRole("button", { name: "Read", exact: true }).click();
    await expect(
      completed.getByText("Completion evidence: Acceptance recorded", { exact: true }),
    ).toBeVisible();
    await completed.getByRole("button", { name: "Open", exact: true }).click();
    await expect(completed.getByTestId("companion-entry-eyebrow")).toContainText("Ask · Open · ");
    await page.reload();
    await page.getByTestId("agent-view-artifacts").click();
    await page
      .getByTestId("local-stream-workflow")
      .getByRole("button", { name: "Tasks", exact: true })
      .click();
    await page
      .getByTestId("local-stream-workflow")
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
    await overrideServerInfoFeatures(page, { durableStream: false, streamWorkflow: false });
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
    await feed.getByRole("button", { name: "Activity", exact: true }).click();
    await expect(feed.getByText("Which host runs this chat?", { exact: true })).toBeVisible();
  } finally {
    await client.removeProject(workspace.projectId);
    await client.close();
    await repo.cleanup();
  }
});
