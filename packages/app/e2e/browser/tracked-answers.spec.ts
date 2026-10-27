import type { CompanionEntry } from "@getpaseo/protocol/companion-stream";
import { expect, test, type Page } from "../support/fixtures";
import { expectComposerVisible, fillComposerDraft } from "../support/helpers/composer";
import { scrollChatAwayFromBottom } from "../support/helpers/agent-bottom-anchor";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

type Agent = Awaited<ReturnType<typeof seedMockAgentWorkspace>>;

// Enter inserts a newline in the compact composer, so send with the button at every width.
async function send(page: Page, text: string): Promise<void> {
  await fillComposerDraft(page, text);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
}

async function trackQuestion(page: Page, prompt: string, compact: boolean): Promise<void> {
  const message = page.getByTestId("user-message").filter({ hasText: prompt });
  // Center it, away from the floating switcher and pane at the top and the composer below.
  await message.evaluate((element) => element.scrollIntoView({ block: "center" }));
  const button = message.getByRole("button", { name: "Track Q&A", exact: true });
  // Message actions are always shown on compact layouts and appear on hover elsewhere.
  if (!compact) await message.getByText(prompt, { exact: true }).hover();
  await button.click();
}

// The expanded pane floats over Chat; collapse it to reach messages beneath, as a user would.
async function setPaneExpanded(page: Page, expanded: boolean): Promise<void> {
  const toggle = page.getByTestId("tracked-answers-toggle");
  if ((await toggle.getAttribute("aria-expanded")) !== String(expanded)) await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", String(expanded));
}

async function streamEntry(agent: Agent, id: string): Promise<CompanionEntry | undefined> {
  const page = await agent.client.listGlobalStream({ agentId: agent.agentId, limit: 100 });
  for (const row of page.rows) {
    if (row.item.kind === "entry" && row.item.entry.id === id) return row.item.entry;
  }
  return undefined;
}

async function answer(agent: Agent, entryId: string, text: string, replyRevision: number) {
  await agent.client.updateStreamEntry({
    agentId: agent.agentId,
    action: "set_reply",
    entryId,
    text,
    replyRevision,
  });
}

for (const width of [390, 1440]) {
  test(`Answers pane: agent asks, Track Q&A candidates, revisions, seen and hide at ${width}px`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    const askText = `Staging ${width}: which database does it use?`;
    const first = `Which port does the preview use? (${width})`;
    const second = `Did the migration finish? (${width})`;
    const agent = await seedMockAgentWorkspace({
      repoPrefix: "tracked-answers-",
      title: "Tracked answers",
      model: "ten-second-stream",
    });
    try {
      await page.setViewportSize({ width, height: 900 });
      await openAgentRoute(page, agent);
      await expectComposerVisible(page);
      const pane = page.getByTestId("tracked-answers-pane");
      const toggle = pane.getByTestId("tracked-answers-toggle");

      // An ask the agent tracks waits in the pane with no tap from the user.
      await agent.client.updateStreamEntry({
        agentId: agent.agentId,
        action: "set_ask",
        entryId: "staging-db",
        text: askText,
        expectedRevision: 0,
        ask: { state: "in_progress", remaining: "Check the staging config", evidence: "" },
      });
      await expect(toggle).toHaveAccessibleName(/1 waiting/);
      // Compact starts collapsed so it never takes the chat over; desktop starts expanded.
      await expect(toggle).toHaveAttribute("aria-expanded", String(width >= 768));
      await setPaneExpanded(page, true);
      const askRow = pane.getByTestId("tracked-answer-ask:staging-db");
      await expect(askRow.getByText("Waiting for answer")).toBeVisible();
      await setPaneExpanded(page, false);

      // Tracking a message after its reply settled gives a candidate, labeled unconfirmed.
      await send(page, first);
      await expect(page.getByTestId("user-message").filter({ hasText: first })).toBeVisible();
      expect((await agent.client.waitForFinish(agent.agentId, 45_000)).status).toBe("idle");
      await trackQuestion(page, first, width < 768);
      await expect(toggle).toHaveAccessibleName(/1 new · 1 waiting/);
      await setPaneExpanded(page, true);
      await expect(pane.getByText("Possible answer")).toBeVisible();
      await expect(pane.getByText(/has not confirmed/)).toBeVisible();
      await setPaneExpanded(page, false);

      // A message tracked while its reply streams waits until the turn completes.
      await send(page, second);
      await expect(page.getByTestId("user-message").filter({ hasText: second })).toBeVisible();
      await trackQuestion(page, second, width < 768);
      await setPaneExpanded(page, true);
      await page.screenshot({ path: testInfo.outputPath(`tracked-answers-waiting-${width}.png`) });

      // The pane floats over the top of Chat and never covers the composer.
      const paneBox = await pane.boundingBox();
      const composerBox = await page
        .getByRole("textbox", { name: "Message agent..." })
        .first()
        .boundingBox();
      expect(paneBox && composerBox && paneBox.y + paneBox.height <= composerBox.y).toBe(true);
      expect((await agent.client.waitForFinish(agent.agentId, 45_000)).status).toBe("idle");
      await expect(toggle).toHaveAccessibleName(/2 new · 1 waiting/);

      // The agent attaches the actual answer to its ask: explicit, unseen, other rows untouched.
      await answer(agent, "ask:staging-db", "Postgres 16 on the shared cluster.", 0);
      await expect(askRow.getByText("New answer")).toBeVisible();
      await expect(askRow.getByText("Postgres 16 on the shared cluster.")).toBeVisible();

      // A late explicit answer replaces the candidate for a tracked message.
      const firstId = (
        await agent.client.listGlobalStream({ agentId: agent.agentId, limit: 100 })
      ).rows.flatMap((row) =>
        row.item.kind === "entry" && row.item.entry.text === first ? [row.item.entry.id] : [],
      )[0]!;
      await answer(agent, firstId, "Port 7420, set in the preview config.", 1);
      const firstRow = pane.getByTestId(`tracked-answer-${firstId}`);
      await expect(firstRow.getByText("New answer")).toBeVisible();
      await expect(firstRow.getByText("Port 7420, set in the preview config.")).toBeVisible();

      // Jump to the exact tracked message after the reader has scrolled elsewhere.
      await scrollChatAwayFromBottom(page, { deltaY: -900, minDistanceFromBottom: 200 }).catch(
        () => undefined,
      );
      await firstRow.getByTestId("tracked-answer-jump-question").click();
      await expect(
        page.getByTestId("user-message").filter({ hasText: first }).first(),
      ).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath(`tracked-answers-new-${width}.png`) });

      // Mark seen is explicit, durable and per revision; a revised answer is new again.
      await askRow.getByTestId("tracked-answer-mark-seen").click();
      await expect(askRow).toHaveCount(0);
      await expect
        .poll(async () => (await streamEntry(agent, "ask:staging-db"))?.replySeenRevision)
        .toBe(1);
      expect((await streamEntry(agent, firstId))?.replySeenRevision).toBeUndefined();
      await answer(agent, "ask:staging-db", "Postgres 16.4 after the upgrade.", 1);
      await expect(askRow.getByText("New answer")).toBeVisible();

      // Collapse keeps the summary; hiding lasts until an answer arrives that was not showing.
      await toggle.click();
      await expect(pane.getByText(second)).toHaveCount(0);
      await pane.getByTestId("tracked-answers-dismiss").click();
      await expect(pane).toHaveCount(0);
      await answer(agent, "ask:staging-db", "Postgres 16.4 on the shared cluster.", 2);
      await expect(pane).toBeVisible();
    } finally {
      await agent.cleanup();
    }
  });
}
