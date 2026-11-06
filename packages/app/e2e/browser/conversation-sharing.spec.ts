import type { ShareRecordPayload } from "@getpaseo/protocol/sharing";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import net from "node:net";
import { expect } from "@playwright/test";
import { test as base } from "../support/fixtures";
import { seedMockAgentWorkspace, openAgentRoute } from "../support/helpers/mock-agent";
import { overrideServerInfoFeatures } from "../support/helpers/server-info-features";

function backgroundColors(elements: Element[]) {
  return elements.map((element) => getComputedStyle(element).backgroundColor);
}

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
        "Outline a focused release. Use /Users/jacob/private/src/release.ts and password=fixture-secret-value as examples. Connect to 100.84.242.74:7070 and db.internal.",
    });
    try {
      await fixture.client.waitForAgentUpsert(
        fixture.agentId,
        (agent) => agent.status === "idle",
        60000,
      );
      // The real local daemon proves revoke behavior; decorate its records to exercise
      // the external host's eventual revocation copy and pending state on both layouts.
      await page.routeWebSocket(daemonWsRoutePattern(), (browserSocket) => {
        const serverSocket = browserSocket.connectToServer();
        browserSocket.onMessage((message) => serverSocket.send(message));
        serverSocket.onMessage((message) => {
          if (typeof message !== "string") {
            browserSocket.send(message);
            return;
          }
          const envelope = JSON.parse(message) as {
            message?: {
              type?: string;
              payload?: { share?: ShareRecordPayload; shares?: ShareRecordPayload[] };
            };
          };
          const payload = envelope.message?.payload;
          if (envelope.message?.type?.startsWith("share.link.") && payload) {
            const decorate = (share: ShareRecordPayload) => ({
              ...share,
              published: {
                kind: "cloudflare-worker" as const,
                baseUrl: "https://shares.example",
                at: share.createdAt,
              },
              ...(share.revokedAt ? { publishState: "unpublish_pending" as const } : {}),
            });
            if (payload.share) payload.share = decorate(payload.share);
            if (payload.shares) payload.shares = payload.shares.map(decorate);
          }
          browserSocket.send(JSON.stringify(envelope));
        });
      });
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
      const hosts = sheet.getByRole("switch", { name: "Hostnames and IP addresses", exact: true });
      await expect(hosts).toBeChecked();
      await expect(sheet.getByTestId("share-preview")).toContainText("hosts 2");
      await expect(sheet.getByTestId("share-preview")).toContainText("[ip]:7070 and [host]");
      await hosts.click();
      await expect(hosts).not.toBeChecked();
      await expect(sheet.getByTestId("share-preview")).toContainText(
        "100.84.242.74:7070 and db.internal",
      );
      await expect(sheet.getByTestId("share-preview")).toContainText("hosts 0");
      await hosts.click();
      await expect(hosts).toBeChecked();
      await expect(sheet.getByTestId("share-preview")).toContainText("[ip]:7070 and [host]");
      await expect(page.getByRole("button", { name: "Create link", exact: true })).toBeEnabled();
      const enabledTrackColors = await sheet
        .getByRole("switch", { name: "Secrets", exact: true })
        .locator("div")
        .evaluateAll(backgroundColors);
      // Reanimated switches expose checked state before the visual transition finishes.
      await expect
        .poll(() => hosts.locator("div").evaluateAll(backgroundColors))
        .toEqual(enabledTrackColors);
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
      await expect(guest).toHaveTitle("Shared conversation");
      await expect(
        guest.getByRole("heading", { name: "Planning a focused release" }),
      ).toBeVisible();
      await expect(guest.getByText(/fixture-secret-value/)).toHaveCount(0);
      await expect(guest.getByText(/100\.84\.242\.74|db\.internal/)).toHaveCount(0);
      await expect(guest.getByText(/\[ip\]:7070 and \[host\]/)).toBeVisible();
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
      await expect(
        sheet.getByText("Revocation at the host completes within about a minute."),
      ).toBeVisible();
      await sheet.getByRole("button", { name: "Revoke", exact: true }).click();
      await expect(sheet.getByText("Revoke pending at the host")).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`share-revoke-pending-${width}.png`),
        fullPage: true,
      });
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

test("shows the bounded earlier-messages label in the compact preview and guest page", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(180000);
  const fixture = await seedMockAgentWorkspace({
    repoPrefix: "share-bounds-qa-",
    title: "A bounded conversation",
    initialPrompt: "emit 500 assistant messages before synthetic user message",
  });
  try {
    await fixture.client.waitForAgentUpsert(
      fixture.agentId,
      (agent) => agent.status === "idle",
      60000,
    );
    await page.setViewportSize({ width: 390, height: 960 });
    await openAgentRoute(page, fixture);
    await page.getByTestId("workspace-header-menu-trigger").click();
    await page.getByTestId("conversation-share-action").click();
    const sheet = page.getByTestId("conversation-share-content");
    const earlier = sheet
      .getByTestId("share-preview")
      .getByText(/\d+ earlier messages? (?:is|are) not included in this snapshot/);
    await expect(earlier).toBeVisible();
    await expect
      .poll(
        async () =>
          (await page.getByText("Share conversation", { exact: true }).boundingBox())?.y ??
          Infinity,
      )
      .toBeLessThan(200);
    const label = await earlier.innerText();
    await expect(page.getByRole("button", { name: "Create link", exact: true })).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath("share-earlier-preview-390.png") });
    await page.getByRole("button", { name: "Create link", exact: true }).click();
    const link = sheet.getByText(/^http:\/\/127\.0\.0\.1:\d+\/s\/[A-Za-z0-9_-]{43}$/, {
      exact: true,
    });
    await expect(link).toBeVisible();
    const guest = await context.newPage();
    await guest.setViewportSize({ width: 390, height: 960 });
    await guest.goto(await link.innerText());
    await expect(guest).toHaveTitle("Shared conversation");
    await expect(guest.getByRole("heading", { name: "A bounded conversation" })).toBeVisible();
    await expect(guest.getByText(label, { exact: true })).toBeVisible();
    await guest.screenshot({ path: testInfo.outputPath("guest-earlier-390.png") });
    await guest.close();
  } finally {
    await fixture.cleanup();
  }
});
