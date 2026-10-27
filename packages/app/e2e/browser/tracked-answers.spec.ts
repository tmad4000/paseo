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

async function trackQuestion(page: Page, prompt: string): Promise<void> {
  const message = page.getByTestId("user-message").filter({ hasText: prompt });
  await message.getByText(prompt, { exact: true }).hover();
  await message.getByRole("button", { name: "Track Q&A", exact: true }).click();
}

async function qAndAEntries(agent: Agent) {
  const page = await agent.client.listGlobalStream({ agentId: agent.agentId });
  return page.rows.flatMap((row) =>
    row.item.kind === "entry" && row.item.entry.kind === "q_and_a" ? [row.item.entry] : [],
  );
}

for (const width of [390, 1440]) {
  test(`Tracked answers pane: waiting, new answer, jump, mark seen, hide at ${width}px`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(150_000);
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

      // A question tracked after its reply settled is answered at once, and stays unseen.
      await send(page, first);
      await expect(page.getByTestId("user-message").filter({ hasText: first })).toBeVisible();
      expect((await agent.client.waitForFinish(agent.agentId, 45_000)).status).toBe("idle");
      await trackQuestion(page, first);
      const pane = page.getByTestId("tracked-answers-pane");
      const toggle = pane.getByTestId("tracked-answers-toggle");
      await expect(toggle).toHaveAccessibleName(/1 new/);
      if (width < 768) {
        // Compact starts collapsed so it never takes the chat over; one tap expands it.
        await expect(pane.getByText("New answer")).toHaveCount(0);
        await toggle.click();
      }
      await expect(pane.getByText("New answer")).toBeVisible();
      await expect(pane.getByText(first)).toBeVisible();

      // A question tracked while its reply is still streaming waits for the turn to settle.
      await send(page, second);
      await expect(page.getByTestId("user-message").filter({ hasText: second })).toBeVisible();
      await trackQuestion(page, second);
      await expect(pane.getByText("Waiting for answer")).toBeVisible();
      await expect(toggle).toHaveAccessibleName(/1 new · 1 waiting/);
      await page.screenshot({ path: testInfo.outputPath(`tracked-answers-waiting-${width}.png`) });

      // The pane floats over the top of Chat and never covers the composer.
      const paneBox = await pane.boundingBox();
      const composerBox = await page
        .getByRole("textbox", { name: "Message agent..." })
        .first()
        .boundingBox();
      expect(paneBox && composerBox && paneBox.y + paneBox.height <= composerBox.y).toBe(true);

      expect((await agent.client.waitForFinish(agent.agentId, 45_000)).status).toBe("idle");
      await expect(toggle).toHaveAccessibleName(/2 new/);
      const entries = await qAndAEntries(agent);
      expect(entries.map((entry) => [entry.text, Boolean(entry.answer), entry.status])).toEqual(
        expect.arrayContaining([
          [first, true, "open"],
          [second, true, "open"],
        ]),
      );
      expect(entries).toHaveLength(2);

      // Jump to the exact question message after the reader has scrolled elsewhere.
      await scrollChatAwayFromBottom(page, { deltaY: -900, minDistanceFromBottom: 200 }).catch(
        () => undefined,
      );
      const firstRow = pane.locator(
        `[data-testid="tracked-answer-${entries.find((entry) => entry.text === first)!.id}"]`,
      );
      await firstRow.getByTestId("tracked-answer-jump-question").click();
      await expect(
        page.getByTestId("user-message").filter({ hasText: first }).first(),
      ).toBeInViewport();
      await firstRow.getByTestId("tracked-answer-jump-answer").click();
      await page.screenshot({ path: testInfo.outputPath(`tracked-answers-new-${width}.png`) });

      // Mark seen is explicit and durable: the row leaves the pane, the entry stays in Stream.
      await firstRow.getByTestId("tracked-answer-mark-seen").click();
      await expect(pane.getByText(first)).toHaveCount(0);
      await expect
        .poll(async () => (await qAndAEntries(agent)).find((entry) => entry.text === first)?.status)
        .toBe("reviewed");
      await expect(toggle).toHaveAccessibleName(/1 new/);

      // Collapse keeps the summary; hiding removes the pane until a new answer arrives.
      await toggle.click();
      await expect(pane.getByText(second)).toHaveCount(0);
      await pane.getByTestId("tracked-answers-dismiss").click();
      await expect(pane).toHaveCount(0);
      expect((await qAndAEntries(agent)).find((entry) => entry.text === second)?.status).toBe(
        "open",
      );
    } finally {
      await agent.cleanup();
    }
  });
}
