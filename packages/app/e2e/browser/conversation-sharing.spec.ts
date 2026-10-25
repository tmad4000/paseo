import net from "node:net";
import { expect } from "@playwright/test";
import { test as base } from "../support/fixtures";
import { seedMockAgentWorkspace, openAgentRoute } from "../support/helpers/mock-agent";
import { overrideServerInfoFeatures } from "../support/helpers/server-info-features";

const test = base.extend({
  e2eDaemonConfig: [
    async ({ e2eForkProviders: _providers }, provide) => {
      const probe = net.createServer();
      await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
      const port = (probe.address() as net.AddressInfo).port;
      await new Promise<void>((resolve) => probe.close(() => resolve()));
      await provide({
        version: 1,
        daemon: {
          sharing: {
            listen: `127.0.0.1:${port}`,
            publicBaseUrl: `http://127.0.0.1:${port}`,
            ownerDisplayName: "Jacob",
          },
        },
      });
    },
    { scope: "worker" },
  ],
});
for (const width of [1440, 390]) {
  test(`shares a previewed snapshot and gates older hosts at ${width}px`, async ({
    page,
    context,
  }, testInfo) => {
    test.setTimeout(180000);
    const fixture = await seedMockAgentWorkspace({
      repoPrefix: "share-qa-",
      title: "Planning a focused release",
      initialPrompt:
        "Outline a focused release. Use /Users/jacob/private/src/release.ts and password=fixture-secret-value as examples.",
    });
    try {
      await fixture.client.waitForAgentUpsert(
        fixture.agentId,
        (agent) => agent.status === "idle",
        60000,
      );
      await page.setViewportSize({ width, height: 960 });
      await openAgentRoute(page, fixture);
      await page.getByTestId("workspace-header-menu-trigger").click();
      await page.getByTestId("conversation-share-action").click();
      const sheet = page.getByTestId("conversation-share-content");
      await expect(sheet.getByTestId("share-preview")).toBeVisible();
      await expect
        .poll(
          async () =>
            (await page.getByText("Share conversation", { exact: true }).boundingBox())?.y ??
            Infinity,
        )
        .toBeLessThan(200);
      await expect(sheet.getByText(/password=fixture-secret-value/)).toHaveCount(0);
      await expect(sheet.getByText(/\[secret hidden\]/)).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`share-sheet-${width}.png`),
        fullPage: true,
      });
      await page.getByRole("button", { name: "Create link", exact: true }).click();
      const link = sheet.getByText(/^http:\/\/127\.0\.0\.1:\d+\/s\/[A-Za-z0-9_-]{43}$/, {
        exact: true,
      });
      await expect(link).toBeVisible();
      await expect(page.getByTestId("conversation-shared-badge")).toHaveText("Shared");
      const url = await link.innerText();
      const guest = await context.newPage();
      await guest.setViewportSize({ width, height: 960 });
      await guest.goto(url);
      await expect(
        guest.getByRole("heading", { name: "Planning a focused release" }),
      ).toBeVisible();
      await expect(guest.getByText(/fixture-secret-value/)).toHaveCount(0);
      await guest.screenshot({
        path: testInfo.outputPath(`guest-light-${width}.png`),
        fullPage: true,
      });
      await guest.emulateMedia({ colorScheme: "dark" });
      await guest.screenshot({
        path: testInfo.outputPath(`guest-dark-${width}.png`),
        fullPage: true,
      });
      await guest.close();
      await sheet.getByRole("button", { name: "Revoke", exact: true }).click();
      await expect.poll(async () => (await page.request.get(url)).status()).toBe(404);
      await expect(page.getByTestId("conversation-shared-badge")).toHaveCount(0);
      await overrideServerInfoFeatures(page, { conversationSharing: false });
      await page.reload();
      await page.getByTestId("workspace-header-menu-trigger").click();
      await expect(page.getByTestId("conversation-share-action")).toHaveCount(0);
      await expect(
        page.getByText("Update the host to share conversations.", { exact: true }),
      ).toBeVisible();
    } finally {
      await fixture.cleanup();
    }
  });
}
