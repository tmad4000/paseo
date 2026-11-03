import { openAskFixture, type OpenAskFixtureOwner } from "@/companion-stream/open-asks-fixture";
import { expect, test } from "../support/fixtures";
import { expectComposerVisible } from "../support/helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

const OWNER_TITLES: Record<OpenAskFixtureOwner, string> = {
  release: "Release agent",
  builder: "Enforce builder",
  designer: "Interface designer",
  homepage: "Homepage curator",
};

for (const width of [390, 1440]) {
  test(`Open asks pane: an orchestration chat's 20 unresolved asks at ${width}px`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    const agent = await seedMockAgentWorkspace({
      repoPrefix: "open-asks-",
      title: "Orchestration",
    });
    try {
      // Real child chats own most asks, so the pane shows their titles and links to them.
      const owners: Partial<Record<OpenAskFixtureOwner, string>> = {};
      for (const [slot, title] of Object.entries(OWNER_TITLES)) {
        const child = await agent.client.createAgent({
          provider: "mock",
          cwd: agent.cwd,
          workspaceId: agent.workspaceId,
          title,
          modeId: "load-test",
          model: "e2e-fast-stream",
        });
        owners[slot as OpenAskFixtureOwner] = child.id;
      }
      // Oldest first, so the host's timestamps keep the fixture's order.
      for (const item of openAskFixture(owners).toReversed()) {
        await agent.client.updateStreamEntry({
          agentId: agent.agentId,
          action: "set_ask",
          entryId: item.id,
          text: item.text,
          expectedRevision: 0,
          ask: item.ask,
        });
      }

      await page.setViewportSize({ width, height: 900 });
      await openAgentRoute(page, agent);
      await expectComposerVisible(page);
      const pane = page.getByTestId("tracked-answers-pane");
      // One control at a time: the open card's Minimize header, or the minimized pill.
      const toggle = pane.getByTestId(/^tracked-answers-(minimize|expand)$/);

      // The 3 question-shaped asks wait as questions; the other 17 are open asks.
      await expect(toggle).toHaveAccessibleName(/3 waiting · 17 open asks · 5 blocked/);
      // Compact starts minimized so it never takes the chat over; desktop starts open.
      await expect(toggle).toHaveAttribute("aria-expanded", String(width >= 768));
      if (width < 768) {
        // The pill is a small count at the right edge, not a full-width bar.
        await expect(toggle).toHaveText("20");
        const pillBox = await toggle.boundingBox();
        expect(pillBox && pillBox.width < 120 && pillBox.x + pillBox.width > width - 40).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`open-asks-pill-${width}.png`) });
        await toggle.click();
      }
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      // The open card's header keeps its title on every width.
      await expect(pane.getByText("Questions and asks", { exact: true })).toBeVisible();

      const section = pane.getByTestId("open-asks-section");
      await expect(section.getByText("Open asks · 17")).toBeVisible();
      const rows = section.getByTestId(/^open-ask-ask:/);
      await expect(rows).toHaveCount(17);
      for (let index = 0; index < 5; index += 1) {
        await expect(rows.nth(index).getByText("Blocked", { exact: true })).toBeVisible();
      }
      const notify = section.getByTestId("open-ask-ask:enforce-notify");
      await expect(notify.getByText("Enforce builder")).toBeVisible();
      await expect(notify.getByText(/^Next: Jacob decides the four open items/)).toBeVisible();

      // Calm and clear of the composer: it floats over the top of Chat only.
      const paneBox = await pane.boundingBox();
      const composerBox = await page
        .getByRole("textbox", { name: "Message agent..." })
        .first()
        .boundingBox();
      expect(paneBox && composerBox && paneBox.y + paneBox.height <= composerBox.y).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`open-asks-${width}.png`) });

      // A prose source is not a loaded message, so the row opens the ask's card in Stream.
      const design = section.getByTestId("open-ask-ask:enforce-design");
      await design.getByTestId("open-ask-open").click();
      await expect(page.getByTestId("local-stream-workflow")).toBeVisible();
      await expect(page.getByTestId("global-stream-search")).toHaveValue(
        "Propose mobile-first interface directions for Enforce.",
      );
      // Chat stays mounted (hidden) behind the Stream, so look inside the Stream only.
      await expect(
        page
          .getByTestId("local-stream-workflow")
          .getByText("Propose mobile-first interface directions for Enforce.", { exact: true }),
      ).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`open-asks-card-${width}.png`) });

      // Back in Chat, the owner link opens the delegated chat.
      await page.getByTestId("agent-view-chat").click();
      if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
      await notify.getByTestId("open-ask-owner").click();
      // A chat in the same workspace opens as its tab (the tab switcher on compact layouts).
      if (width < 768) {
        await expect(page.getByTestId("workspace-tab-switcher-trigger")).toContainText(
          OWNER_TITLES.builder,
        );
      } else {
        await expect(
          page.getByTestId(`workspace-tab-agent_${owners.builder}`).first(),
        ).toHaveAttribute("aria-selected", "true");
      }
    } finally {
      await agent.cleanup();
    }
  });
}
