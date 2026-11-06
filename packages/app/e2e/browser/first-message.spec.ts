import { expect, test, type Page } from "../support/fixtures";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import {
  expectReconnectingToastVisible,
  expectReconnectingToastGone,
  waitForSidebarHydration,
} from "../support/helpers/workspace-ui";
import { openCommandCenter } from "../support/helpers/command-center";
import { installDaemonWebSocketGate } from "../support/helpers/daemon-websocket-gate";

async function openFirstMessage(page: Page) {
  await page.getByTestId("workspace-header-menu-trigger").filter({ visible: true }).click();
  await page.getByTestId("workspace-header-first-message").click();
}

const original =
  "Help me remember the original purpose of this chat.\n\n" +
  "This detail belongs to the full original request, beyond a short preview. ".repeat(12) +
  "END OF ORIGINAL REQUEST";

for (const [layout, viewport] of [
  ["desktop", { width: 1440, height: 900 }],
  ["compact", { width: 390, height: 844 }],
] as const) {
  test(`${layout}: reads the full first message without replacing the loaded chat`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const agent = await seedMockAgentWorkspace({
      repoPrefix: "first-message-",
      title: "Recall first message",
      initialPrompt: original,
    });
    try {
      await agent.client.waitForFinish(agent.agentId, 15_000);
      for (let i = 0; i < 25; i++) {
        await agent.client.sendAgentMessage(
          agent.agentId,
          `Follow-up ${i}: emit 1 coalesced agent stream updates`,
        );
        await agent.client.waitForFinish(agent.agentId, 15_000);
      }
      await page.setViewportSize(viewport);
      await openAgentRoute(page, agent);
      const newest = page.getByText("Follow-up 24: emit 1 coalesced agent stream updates", {
        exact: true,
      });
      await expect(newest).toBeVisible();
      await expect(page.getByText(original, { exact: true })).toHaveCount(0);
      const before = await newest.boundingBox();
      await openFirstMessage(page);
      await expect(page.getByTestId("first-message-text")).toHaveText(original);
      await expect(page.getByTestId("first-message-text")).toBeInViewport();
      await page
        .getByTestId("first-message-sheet")
        .getByRole("button", { name: "Close", exact: true })
        .click({ trial: true });
      await page.screenshot({ path: testInfo.outputPath(`${layout}-first-message.png`) });
      const sheet = page.getByTestId("first-message-sheet");
      await sheet.getByRole("button", { name: "Close", exact: true }).click();
      await expect(sheet).toHaveCount(0);
      await expect(newest).toBeVisible();
      const after = await newest.boundingBox();
      expect(after?.y).toBe(before?.y);
      await expect(page.getByText(original, { exact: true })).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath(`${layout}-chat-control.png`) });
    } finally {
      await agent.cleanup();
    }
  });
}

test("an empty chat is refreshed after its first message is sent", async ({ page }) => {
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "first-message-empty-",
    title: "Empty chat",
  });
  try {
    await openAgentRoute(page, agent);
    await openFirstMessage(page);
    await expect(page.getByTestId("first-message-empty")).toHaveText(
      "No messages have been sent in this chat yet.",
    );
    await page
      .getByTestId("first-message-sheet")
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await agent.client.sendAgentMessage(agent.agentId, "The first message arrived.");
    await agent.client.waitForFinish(agent.agentId, 15_000);
    await openFirstMessage(page);
    await expect(page.getByTestId("first-message-text")).toHaveText("The first message arrived.");
  } finally {
    await agent.cleanup();
  }
});

test("a disconnected read shows an error and Retry recovers", async ({ page }) => {
  const gate = await installDaemonWebSocketGate(page);
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "first-message-retry-",
    title: "Retry first message",
    initialPrompt: "Remember this request.",
  });
  try {
    await agent.client.waitForFinish(agent.agentId, 15_000);
    await openAgentRoute(page, agent);
    await expect(page.getByTestId("assistant-message").first()).toBeVisible();
    await expect(page.getByText("Retry first message", { exact: true }).first()).toBeVisible();
    await waitForSidebarHydration(page);
    await gate.drop();
    await expectReconnectingToastVisible(page);
    await openFirstMessage(page);
    await expect(page.getByTestId("first-message-error")).toContainText(
      "Could not load the first message.",
    );
    gate.restore();
    await expectReconnectingToastGone(page);
    await page
      .getByTestId("first-message-error")
      .getByRole("button", { name: "Retry", exact: true })
      .click();
    await expect(page.getByTestId("first-message-text")).toHaveText("Remember this request.");
  } finally {
    gate.restore();
    await agent.cleanup();
  }
});

test("Command Center opens the current chat's first message", async ({ page }) => {
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "first-message-command-",
    title: "Command Center recall",
    initialPrompt: "The original keyboard-accessible request.",
  });
  try {
    await agent.client.waitForFinish(agent.agentId, 15_000);
    await openAgentRoute(page, agent);
    await expect(page.getByTestId("assistant-message").first()).toBeVisible();
    const panel = await openCommandCenter(page);
    await panel.getByTestId("command-center-input").fill("First message");
    await panel.getByRole("button", { name: "First message", exact: true }).click();
    await expect(page.getByTestId("first-message-text")).toHaveText(
      "The original keyboard-accessible request.",
    );
    await expect(page.getByTestId("first-message-text")).toBeInViewport();
  } finally {
    await agent.cleanup();
  }
});
