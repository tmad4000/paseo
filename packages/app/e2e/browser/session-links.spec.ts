import { randomUUID } from "node:crypto";
import { test, expect } from "../support/fixtures";
import { seedWorkspace } from "../support/helpers/seed-client";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { getServerId } from "../support/helpers/server-id";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });
for (const width of [1100, 390])
  test(`full-app session link actions at ${width}px`, async ({ page }, testInfo) => {
    testInfo.setTimeout(180_000);
    await page.setViewportSize({ width, height: 844 });
    const workspace = await seedWorkspace({ repoPrefix: "session-links-b2k-" });
    try {
      const common = {
        provider: "mock",
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        modeId: "load-test",
        model: "e2e-fast-stream",
      };
      const target = await workspace.client.createAgent({ ...common, title: "Linked destination" });
      const href = `paseo-fork://h/${getServerId()}/agent/${target.id}`;
      const unknown = `paseo-fork://h/not-a-saved-host/agent/${target.id}`;
      const source = await workspace.client.createAgent({
        ...common,
        title: "Session link source",
        featureValues: {
          mockStreamingAssistantResponse: `[Visit linked session](${href}) and [Unknown host](${unknown}) and [Missing session](paseo-fork://h/${getServerId()}/agent/00000000-0000-4000-8000-000000000000) and [Invalid session](${href}?redirect=evil)`,
          mockStreamingAssistantIntervalMs: 1,
        },
      });
      await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: source.id });
      await workspace.client.sendAgentMessage(source.id, "Show the session links.");
      await workspace.client.waitForFinish(source.id, 30_000);
      const link = page
        .getByTestId("assistant-message")
        .getByRole("link", { name: "Visit linked session", exact: true });
      await expect(link).toBeVisible({ timeout: 45_000 });
      await expect(link).toHaveAttribute("href", href);
      await link.click({ button: "right" });
      await expect(page.getByRole("menuitem", { name: "Open session", exact: true })).toBeVisible();
      await expect(
        page.getByRole("menuitem", { name: "Save message to Stream", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("menuitem", { name: "Copy link", exact: true })
        .waitFor({ state: "visible" });
      await page.screenshot({
        path: testInfo.outputPath(`session-link-menu-${width}.png`),
        fullPage: true,
      });
      await page.getByRole("menuitem", { name: "Copy link", exact: true }).click();
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(href);
      await expect(page.getByRole("menuitem", { name: "Copy link", exact: true })).toHaveCount(0);
      await page
        .getByTestId("assistant-message")
        .getByRole("link", { name: "Unknown host", exact: true })
        .click();
      await expect(
        page.getByText("This session link points to a host that is not saved here.", {
          exact: true,
        }),
      ).toBeVisible();
      await page
        .getByTestId("assistant-message")
        .getByRole("link", { name: "Missing session", exact: true })
        .click();
      await expect(
        page.getByText("This session was not found on the linked host.", { exact: true }),
      ).toBeVisible();
      await page
        .getByTestId("assistant-message")
        .getByRole("link", { name: "Invalid session", exact: true })
        .click();
      await expect(page.getByText("This session link is invalid.", { exact: true })).toBeVisible();
      await link.click();
      await expect(page).toHaveTitle(/Linked destination/, { timeout: 20_000 });
      await page.screenshot({
        path: testInfo.outputPath(`session-link-opened-${width}.png`),
        fullPage: true,
      });
      await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: source.id });
      await expect(link).toBeVisible({ timeout: 20_000 });
      await link.focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveTitle(/Linked destination/, { timeout: 20_000 });
      if (width <= 500) {
        await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: source.id });
        await expect(link).toBeVisible();
        for (const gesture of ["modifier", "middle"] as const) {
          const sourceUrl = page.url();
          const paneCount = await page.locator('[data-testid^="workspace-pane-"]').count();
          if (gesture === "modifier") {
            await link.click({ modifiers: ["Control"] });
          } else {
            await link.click({ button: "middle" });
          }
          await expect(
            page
              .getByText(
                "Open beside is unavailable for this session. Use Open session or, when supported, Open session in new window.",
                { exact: true },
              )
              .last(),
          ).toBeVisible();
          await expect(link).toBeVisible();
          await expect(page).toHaveTitle(/Session link source/);
          await expect(page).toHaveURL(sourceUrl);
          await expect(page.locator('[data-testid^="workspace-pane-"]')).toHaveCount(paneCount);
        }
        await page.screenshot({
          path: testInfo.outputPath("session-link-compact-preserved.png"),
          fullPage: true,
        });
      } else {
        await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: source.id });
        await expect(link).toBeVisible();
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.keyboard.press(`${process.platform === "darwin" ? "Meta" : "Control"}+Shift+F`);
        const exitFocusMode = page.getByRole("button", { name: "Exit focus mode" });
        await expect(exitFocusMode).toBeVisible();
        const sourceUrl = page.url();
        const paneCount = await page.locator('[data-testid^="workspace-pane-"]').count();
        await link.click({ button: "right" });
        await page.getByRole("menuitem", { name: "Open session beside", exact: true }).click();
        await expect(
          page.getByText(
            "Open beside is unavailable for this session. Use Open session or, when supported, Open session in new window.",
            { exact: true },
          ),
        ).toBeVisible();
        await expect(link).toBeVisible();
        await expect(page).toHaveTitle(/Session link source/);
        await expect(page).toHaveURL(sourceUrl);
        await expect(exitFocusMode).toBeVisible();
        await expect(page.locator('[data-testid^="workspace-pane-"]')).toHaveCount(paneCount);
        await page.screenshot({
          path: testInfo.outputPath("session-link-focus-preserved.png"),
          fullPage: true,
        });
        await exitFocusMode.click();
        await expect(exitFocusMode).toHaveCount(0);
        await link.click({ modifiers: ["Control"] });
        await expect(link).toBeVisible();
        await expect(page).toHaveTitle(/Linked destination/, { timeout: 20_000 });
        await page.screenshot({
          path: testInfo.outputPath("session-link-beside.png"),
          fullPage: true,
        });
      }
      await testInfo.attach("installed-boundary", {
        body: "Full web app with an isolated mock daemon. No installed desktop or native-device interaction claim.",
        contentType: "text/plain",
      });
    } finally {
      await workspace.cleanup();
    }
  });

test("opening a rendered self-link beside preserves its source pane", async ({ page }, info) => {
  info.setTimeout(180_000);
  await page.setViewportSize({ width: 1100, height: 844 });
  const workspace = await seedWorkspace({ repoPrefix: "session-links-self-b2k-" });
  try {
    // The creation API accepts a caller-selected ID, so the mock assistant can emit
    // its own real session URL without mutating the rendered link or its handlers.
    const agentId = randomUUID();
    const href = `paseo-fork://h/${getServerId()}/agent/${agentId}`;
    const source = await workspace.client.createAgent({
      agentId,
      provider: "mock",
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Self-link source",
      modeId: "load-test",
      model: "e2e-fast-stream",
      featureValues: {
        mockStreamingAssistantResponse: `[Open this session](${href})`,
        mockStreamingAssistantIntervalMs: 1,
      },
    });
    expect(source.id).toBe(agentId);
    await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId });
    await workspace.client.sendAgentMessage(agentId, "Show the self-link.");
    await workspace.client.waitForFinish(agentId, 30_000);
    const link = page
      .getByTestId("assistant-message")
      .getByRole("link", { name: "Open this session", exact: true });
    await expect(link).toBeVisible({ timeout: 45_000 });
    await expect(link).toHaveAttribute("href", href);
    await expect(page).toHaveTitle(/Self-link source/);
    const sourceUrl = page.url();
    const panes = page.locator('[data-testid^="workspace-pane-"]');
    const paneCount = await panes.count();
    const sourcePane = panes.filter({ visible: true }).filter({ has: link });
    const sourcePaneId = await sourcePane.getAttribute("data-testid");
    if (sourcePaneId === null) throw new Error("Self-link source pane has no test ID");
    const sideUnavailable = page.getByText(
      "Open beside is unavailable for this session. Use Open session or, when supported, Open session in new window.",
      { exact: true },
    );
    for (const gesture of ["modifier", "middle", "context menu"] as const) {
      // Wait for the previous toast to expire so each gesture must report its own failure.
      await expect(sideUnavailable).toHaveCount(0);
      if (gesture === "context menu") {
        await link.click({ button: "right" });
        await page.getByRole("menuitem", { name: "Open session beside", exact: true }).click();
      } else if (gesture === "middle") {
        await link.click({ button: "middle" });
      } else {
        await link.click({ modifiers: ["Control"] });
      }
      await expect(sideUnavailable).toBeVisible();
      await expect(link).toBeVisible();
      await expect(sourcePane).toHaveAttribute("data-testid", sourcePaneId);
      await expect(page).toHaveTitle(/Self-link source/);
      await expect(page).toHaveURL(sourceUrl);
      await expect(panes).toHaveCount(paneCount);
      await page.screenshot({
        path: info.outputPath(`preserved-self-source-${gesture.replace(" ", "-")}.png`),
        fullPage: true,
      });
    }
    await link.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Open session", exact: true }).click();
    await expect(link).toBeVisible();
    await expect(page).toHaveTitle(/Self-link source/);
    await expect(page).toHaveURL(sourceUrl);
    await expect(panes).toHaveCount(paneCount);
  } finally {
    await workspace.cleanup();
  }
});

for (const gesture of ["modifier", "context menu"] as const) {
  test(`opening beside from a side-pane source preserves it via ${gesture}`, async ({
    page,
  }, info) => {
    info.setTimeout(180_000);
    await page.setViewportSize({ width: 1100, height: 844 });
    const workspace = await seedWorkspace({ repoPrefix: "session-links-side-b2k-" });
    try {
      const common = {
        provider: "mock",
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        modeId: "load-test",
        model: "e2e-fast-stream",
      };
      const destination = await workspace.client.createAgent({
        ...common,
        title: "Third destination",
      });
      const thirdHref = `paseo-fork://h/${getServerId()}/agent/${destination.id}`;
      const side = await workspace.client.createAgent({
        ...common,
        title: "Origin already beside",
        featureValues: {
          mockStreamingAssistantResponse: `[Open third destination](${thirdHref})`,
          mockStreamingAssistantIntervalMs: 1,
        },
      });
      const sideHref = `paseo-fork://h/${getServerId()}/agent/${side.id}`;
      const main = await workspace.client.createAgent({
        ...common,
        title: "Main source",
        featureValues: {
          mockStreamingAssistantResponse: `[Open side origin](${sideHref})`,
          mockStreamingAssistantIntervalMs: 1,
        },
      });
      await workspace.client.sendAgentMessage(side.id, "Show link");
      await workspace.client.waitForFinish(side.id, 30_000);
      await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: main.id });
      await workspace.client.sendAgentMessage(main.id, "Show link");
      await workspace.client.waitForFinish(main.id, 30_000);
      const first = page
        .getByTestId("assistant-message")
        .getByRole("link", { name: "Open side origin", exact: true });
      await expect(first).toBeVisible({ timeout: 45_000 });
      await first.click({ modifiers: ["Control"] });
      const originating = page
        .getByTestId("assistant-message")
        .getByRole("link", { name: "Open third destination", exact: true });
      await expect(originating).toBeVisible();
      if (gesture === "context menu") {
        const mainPane = page
          .locator('[data-testid^="workspace-pane-"]')
          .filter({ visible: true })
          .filter({ has: first });
        await mainPane.getByRole("textbox").click();
        await expect(page).toHaveTitle(/Main source/);
        await originating.click({ button: "right" });
        await page.getByRole("menuitem", { name: "Open session beside", exact: true }).click();
      } else {
        await originating.click({ modifiers: ["Control"] });
      }
      await expect(originating).toBeVisible();
      await expect(
        page.getByText(
          "Open beside is unavailable for this session. Use Open session or, when supported, Open session in new window.",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(page).not.toHaveTitle(/Third destination/);
      await page.screenshot({
        path: info.outputPath(`preserved-side-source-${gesture.replace(" ", "-")}.png`),
      });
    } finally {
      await workspace.cleanup();
    }
  });
}
