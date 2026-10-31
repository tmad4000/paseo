import { expect } from "@playwright/test";
import { test } from "../support/fixtures";
import { composerLocator } from "../support/helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

test("Reply quotes a message into the same chat's composer and keeps the draft", async ({
  page,
}) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(15_000);
  const session = await seedMockAgentWorkspace({
    repoPrefix: "chat-reply-quote-",
    title: "Chat reply quote",
    initialPrompt: "Give me two lines to reply to.",
    featureValues: { mockAssistantResponse: "First line to quote.\n\nSecond line." },
  });
  try {
    await page.setViewportSize({ width: 1440, height: 950 });
    await openAgentRoute(page, session);
    await session.client.waitForFinish(session.agentId, 45_000);

    const composer = composerLocator(page);
    await composer.fill("my draft");

    // The assistant turn's Reply is the last one; the user prompt's comes first.
    const replies = page.getByRole("button", { name: "Reply", exact: true });
    await expect(replies.last()).toBeVisible();
    await replies.last().click();
    await expect(composer).toHaveValue("> First line to quote.\n>\n> Second line.\n\nmy draft");
    await expect(composer).toBeFocused();

    await replies.first().hover();
    await replies.first().click();
    await expect(composer).toHaveValue(
      "> Give me two lines to reply to.\n\n> First line to quote.\n>\n> Second line.\n\nmy draft",
    );
  } finally {
    await session.cleanup();
  }
});
