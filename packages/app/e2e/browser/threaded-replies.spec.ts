import { expect, test } from "../support/fixtures";
import { awaitAssistantMessage } from "../support/helpers/agent-stream";
import { expectChatHistoryAttachment } from "../support/helpers/assistant-fork";
import { expectComposerVisible } from "../support/helpers/composer";
import { closeWorkspaceAgentTab } from "../support/helpers/archive-tab";
import {
  openAgentRoute,
  seedMockAgentWorkspace,
  type MockAgentWorkspace,
} from "../support/helpers/mock-agent";

const COMPOSER = "Message agent...";
const PARENT_LABEL = "paseo.thread-parent";
const ANCHOR_LABEL = "paseo.thread-anchor";

async function findThread(session: MockAgentWorkspace) {
  const { entries } = await session.client.fetchAgents();
  return entries.find(({ agent }) => agent.labels?.[PARENT_LABEL] === session.agentId)?.agent;
}

// Reply in thread (docs/threaded-replies.md): a side session forked at one reply, opened beside
// the main chat, linked by labels, reopened from an "N replies" chip, and able to queue its
// answer back into the main chat.
test.describe("Threaded replies", () => {
  test.describe.configure({ timeout: 240_000 });
  let session: MockAgentWorkspace | null = null;

  test.afterEach(async () => {
    await session?.cleanup();
    session = null;
  });

  test("replies in a thread beside the main chat and sends the answer back", async ({ page }) => {
    session = await seedMockAgentWorkspace({
      repoPrefix: "threaded-replies-",
      title: "Thread parent",
      initialPrompt: "emit 1 coalesced agent stream updates for the thread anchor.",
      model: "ten-second-stream",
    });
    await openAgentRoute(page, session);
    await expectComposerVisible(page);
    await awaitAssistantMessage(page);
    await session.client.waitForFinish(session.agentId, 45_000);
    const routeBefore = page.url();
    const parentTab = page.getByTestId(`workspace-tab-agent_${session.agentId}`).first();

    // Reply in thread opens a chat-history draft beside the main chat; the main chat stays put.
    await page.getByTestId("turn-reply-in-thread").last().click();
    await expect(page.getByRole("textbox", { name: COMPOSER })).toHaveCount(2, {
      timeout: 30_000,
    });
    await expectChatHistoryAttachment(page);
    expect(page.url()).toBe(routeBefore);
    await expect(parentTab).toHaveAttribute("aria-selected", "true");

    // The thread's first message creates it already linked to the parent and the reply.
    const threadComposer = page.getByRole("textbox", { name: COMPOSER }).last();
    await threadComposer.fill("emit 1 coalesced agent stream updates for the thread reply.");
    await threadComposer.press("Enter");
    await expect
      .poll(async () => (await findThread(session!))?.id ?? null, { timeout: 30_000 })
      .not.toBeNull();
    const thread = (await findThread(session))!;
    expect(thread.labels?.[ANCHOR_LABEL]).toBeTruthy();
    await session.client.waitForFinish(thread.id, 60_000);

    // The reply it answers shows the thread, and the chip reopens it once closed.
    const chip = page.getByTestId("turn-thread-replies").first();
    await expect(chip).toHaveText("1 reply", { timeout: 30_000 });
    await page.screenshot({ path: test.info().outputPath("threaded-replies-open.png") });

    // Send to main queues the thread's answer in the parent, quoted, without interrupting it.
    await page.getByTestId("thread-origin-menu").click();
    const sendBack = page.getByTestId("thread-send-to-main");
    await expect(sendBack).toBeVisible({ timeout: 30_000 });
    await expect(sendBack).not.toHaveAttribute("aria-disabled", "true");
    await sendBack.click();
    await expect(
      page.getByTestId("user-message").filter({ hasText: "From the side thread" }).first(),
    ).toBeVisible({ timeout: 60_000 });

    await page
      .getByTestId(`workspace-tab-agent_${thread.id}`)
      .filter({ visible: true })
      .first()
      .hover();
    await closeWorkspaceAgentTab(page, thread.id);
    await expect(page.getByRole("textbox", { name: COMPOSER })).toHaveCount(1, { timeout: 30_000 });
    await chip.click();
    await expect(page.getByRole("textbox", { name: COMPOSER })).toHaveCount(2, {
      timeout: 30_000,
    });
    await page.screenshot({ path: test.info().outputPath("threaded-replies-reopened.png") });
  });
});
