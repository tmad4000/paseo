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
      if (width > 500) {
        await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: source.id });
        await expect(link).toBeVisible();
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
