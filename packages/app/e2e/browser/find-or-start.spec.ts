import { expect, test } from "../support/fixtures";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";
import {
  closeSidebarDisplayPreferences,
  selectSidebarStatusGrouping,
} from "../support/helpers/sidebar";

// The sidebar's one field (docs/sidebar-filter.md, "One field"): typing finds chats live, Enter
// starts a new chat with the text through Quick launch, a pasted session id opens that chat, and
// "Send" on a match makes it the destination of the typed text.
test.describe("Find or start", () => {
  let workspace: SeededWorkspace;
  let home: { id: string };
  let target: { id: string };

  test.beforeAll(async () => {
    workspace = await seedWorkspace({ repoPrefix: "find-or-start-" });
    home = await workspace.client.createAgent({
      provider: "mock",
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Find home",
      modeId: "load-test",
      model: "ten-second-stream",
    });
    target = await workspace.client.createAgent({
      provider: "mock",
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Relay reconnect investigation",
      modeId: "load-test",
      model: "ten-second-stream",
    });
    for (const id of [home.id, target.id]) {
      await workspace.client.waitForAgentUpsert(id, (s) => s.status === "idle");
    }
  });

  test.afterAll(async () => {
    await workspace?.cleanup();
  });

  for (const grouping of ["project", "status"] as const) {
    test(`a ${grouping} workspace search result selects its unique matching chat tab`, async ({
      page,
    }) => {
      await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: target.id });
      await waitForSidebarHydration(page);
      if (grouping === "status") {
        await selectSidebarStatusGrouping(page);
        await closeSidebarDisplayPreferences(page);
      }
      // Keep the matching tab open, but leave another tab selected. The workspace row must
      // carry the match rather than fall back to its usual attention/recency choice.
      await page.getByTestId(`workspace-tab-agent_${home.id}`).filter({ visible: true }).click();
      await expect(
        page.getByTestId(`workspace-tab-agent_${home.id}`).filter({ visible: true }),
      ).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("textbox", { name: "Message agent..." })).toBeEditable();
      const field = page.getByTestId("sidebar-title-project-filter");
      await field.click();
      await field.fill("Relay reconnect");
      await expect(field).toHaveValue("Relay reconnect");
      await expect(
        page.getByTestId(`sidebar-filter-tab-match-${getServerId()}-${target.id}`),
      ).toBeVisible();
      await page
        .getByTestId(`sidebar-workspace-row-${getServerId()}:${workspace.workspaceId}`)
        .click();
      const targetTab = page
        .getByTestId(`workspace-tab-agent_${target.id}`)
        .filter({ visible: true });
      await expect(targetTab).toHaveCount(1);
      await expect(targetTab).toHaveAttribute("aria-selected", "true");
      await expect(
        page.getByTestId(`workspace-tab-agent_${home.id}`).filter({ visible: true }),
      ).toHaveAttribute("aria-selected", "false");
      // The indented title result has the same direct-navigation contract.
      await page.getByTestId(`workspace-tab-agent_${home.id}`).filter({ visible: true }).click();
      await page.getByTestId(`sidebar-filter-tab-match-${getServerId()}-${target.id}`).click();
      await expect(targetTab).toHaveAttribute("aria-selected", "true");
      await expect(targetTab).toHaveCount(1);
    });
  }

  test("Enter starts a new chat with the text; nothing is created until Quick launch starts it", async ({
    page,
  }) => {
    await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: home.id });
    await waitForSidebarHydration(page);
    const before = (await workspace.client.fetchAgents()).entries.length;
    const composer = page.getByTestId("session-routing-composer");
    const field = composer.getByTestId("sidebar-title-project-filter");

    await field.fill("relay reconnect");
    const actions = composer.getByTestId("routing-query-actions");
    await expect(actions.getByTestId("routing-new-chat")).toContainText("relay reconnect");
    await expect(actions.getByTestId("routing-find-ai")).toBeVisible();
    // The live match is on screen before Enter, one click away.
    await expect(
      page.getByTestId(`sidebar-filter-send-here-${getServerId()}-${target.id}`),
    ).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: test.info().outputPath("find-or-start-typing.png") });

    await field.press("Enter");
    const dialog = page.getByTestId("quick-launch-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("quick-launch-prompt")).toHaveValue("relay reconnect");
    expect((await workspace.client.fetchAgents()).entries.length).toBe(before);
  });

  test("a pasted session id opens that chat on Enter", async ({ page }) => {
    await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: home.id });
    await waitForSidebarHydration(page);
    const composer = page.getByTestId("session-routing-composer");
    const field = composer.getByTestId("sidebar-title-project-filter");

    await field.fill(target.id.slice(0, 8));
    const open = composer.getByTestId("routing-open-session");
    await expect(open).toContainText("Relay reconnect investigation");
    await page.screenshot({ path: test.info().outputPath("find-or-start-session-id.png") });
    await field.press("Enter");
    await expect(
      page.getByTestId(`workspace-tab-agent_${target.id}`).filter({ visible: true }).first(),
    ).toHaveAttribute("aria-selected", "true", { timeout: 30_000 });
    await expect(page.getByTestId("quick-launch-dialog")).toHaveCount(0);
  });

  test("Send on a match makes it the destination of the typed text", async ({ page }) => {
    await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: home.id });
    await waitForSidebarHydration(page);
    const composer = page.getByTestId("session-routing-composer");
    const field = composer.getByTestId("sidebar-title-project-filter");

    await field.fill("Relay reconnect");
    await page.getByTestId(`sidebar-filter-send-here-${getServerId()}-${target.id}`).click();
    await expect(composer.getByTestId("routing-recipient")).toContainText(
      "Relay reconnect investigation",
    );
    await expect(composer.getByTestId("routing-send-draft")).toHaveValue("Relay reconnect");
    await page.screenshot({ path: test.info().outputPath("find-or-start-send-here.png") });
    // Back returns to the one field without sending anything.
    await composer.getByTestId("routing-find-mode").click();
    await expect(field).toBeVisible();
  });

  test("✕ clears the field and keeps focus in it", async ({ page }) => {
    await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: home.id });
    await waitForSidebarHydration(page);
    const composer = page.getByTestId("session-routing-composer");
    const field = composer.getByTestId("sidebar-title-project-filter");

    await field.fill("relay reconnect");
    await composer.getByTestId("sidebar-title-project-filter-clear").click();
    await expect(field).toHaveValue("");
    await expect(field).toBeFocused();
    await expect(composer.getByTestId("sidebar-title-project-filter-clear")).toHaveCount(0);
    // Typing goes straight back into the field.
    await page.keyboard.type("relay");
    await expect(field).toHaveValue("relay");
  });

  test("the find row's controls explain themselves on hover", async ({ page }) => {
    await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: home.id });
    await waitForSidebarHydration(page);
    const composer = page.getByTestId("session-routing-composer");
    const field = composer.getByTestId("sidebar-title-project-filter");
    await field.fill("relay");

    const hovers = [
      ["routing-send-mode", "routing-send-mode-tooltip", "Send this text to a chat you pick"],
      [
        "sidebar-title-project-filter-clear",
        "sidebar-title-project-filter-clear-tooltip",
        "Clear sidebar filter",
      ],
      ["sidebar-filter-scope-trigger", "sidebar-filter-scope-tooltip", "Filter scope:"],
      ["sidebar-sort-trigger", "sidebar-sort-tooltip", "Sort chats:"],
    ] as const;
    for (const [trigger, tooltip, text] of hovers) {
      await composer.getByTestId(trigger).hover();
      await expect(page.getByTestId(tooltip)).toBeVisible();
      await expect(page.getByTestId(tooltip)).toContainText(text);
      await page.screenshot({ path: test.info().outputPath(`${tooltip}.png`) });
    }

    // Opening a menu hides its tooltip; the menu still opens.
    await composer.getByTestId("sidebar-sort-trigger").click();
    await expect(page.getByTestId("sidebar-sort-recent")).toBeVisible();
    await expect(page.getByTestId("sidebar-sort-tooltip")).toHaveCount(0);
    await page.keyboard.press("Escape");
  });
});
