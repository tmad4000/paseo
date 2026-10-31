import { mkdir } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { chatLinksFixture } from "@/chat-links/fixture";
import { normalizeLinkKey } from "@/chat-links/model";
import { expect, test, type Page } from "../support/fixtures";
import { expectComposerVisible } from "../support/helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

// Tall enough that the user's message scrolls out of view, so Jump has somewhere to go.
const FILLER = Array.from(
  { length: 24 },
  (_, index) => `Design note ${index + 1}: spacing, contrast and the voice level meter.`,
).join("\n\n");

/** Stands in for the Lavish host: two mock pages that allow framing. */
async function startMockPages(): Promise<{ origin: string; server: Server }> {
  const server = createServer((request, response) => {
    const name = request.url?.includes("7baafb") ? "Dense voice settings" : "Calm voice settings";
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(
      `<!doctype html><title>${name}</title><body style="font:16px system-ui;margin:40px"><h1>${name}</h1><p>Mock page served by the e2e test.</p></body>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { origin: `http://127.0.0.1:${port}`, server };
}

function linkRow(page: Page, url: string) {
  return page.getByTestId(`chat-link-row-${normalizeLinkKey(url)}`).filter({ visible: true });
}

/** Top-level test-results PNGs are uploaded by CI on success; docs/chat-links/ comes from them. */
async function evidence(page: Page, name: string) {
  const file = path.resolve("test-results", name);
  await mkdir(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, animations: "disabled" });
}

async function openLinksPanel(page: Page) {
  await page.getByTestId("chat-links-track-header").filter({ visible: true }).click();
  await expect(
    page.getByTestId("chat-links-section-produced").filter({ visible: true }),
  ).toBeVisible();
}

async function closePeek(page: Page) {
  await page
    .getByRole("button", { name: "Close", exact: true })
    .filter({ visible: true })
    .last()
    .click();
}

for (const width of [390, 1440]) {
  test(`Links track: a design chat's mocks, PR and pasted link at ${width}px`, async ({ page }) => {
    test.setTimeout(180_000);
    const pages = await startMockPages();
    const fixture = chatLinksFixture(pages.origin);
    const agent = await seedMockAgentWorkspace({
      repoPrefix: "chat-links-",
      title: "Voice assistant design",
      initialPrompt: fixture.prompt,
      featureValues: {
        mockAssistantResponse: `${fixture.response}\n\n${FILLER}`,
        mockShellToolCalls: fixture.shellCalls,
      },
    });
    try {
      await page.setViewportSize({ width, height: 900 });
      await openAgentRoute(page, agent);
      await expectComposerVisible(page);
      await expect(page.getByText("Design note 24:", { exact: false }).last()).toBeVisible();

      // Two mocks first printed by Bash, a PR the agent cited, and the user's reference.
      const pill = page.getByTestId("chat-links-track-header").filter({ visible: true });
      await expect(pill).toHaveAccessibleName("4 links in this chat");
      await expect(pill).toContainText("4 links");

      await openLinksPanel(page);
      const produced = page.getByTestId("chat-links-section-produced").filter({ visible: true });
      await expect(produced.getByText("Produced by this chat · 2")).toBeVisible();
      await expect(
        page
          .getByTestId("chat-links-section-agent")
          .filter({ visible: true })
          .getByText("Mentioned by the agent · 1"),
      ).toBeVisible();
      await expect(
        page
          .getByTestId("chat-links-section-you")
          .filter({ visible: true })
          .getByText("You shared · 1"),
      ).toBeVisible();
      // Newest first: the second mock leads its section.
      await expect(produced.getByTestId(/^chat-link-row-/).first()).toHaveAttribute(
        "data-testid",
        `chat-link-row-${normalizeLinkKey(fixture.urls.lavishSecond)}`,
      );
      // Its context is the prose that cited it, not the terminal line that printed it.
      await expect(linkRow(page, fixture.urls.lavishFirst)).toContainText(
        "Review the interactive mock:",
      );
      await expect(linkRow(page, fixture.urls.pr)).toContainText("PR #154");
      await evidence(page, `chat-links-${width}.png`);

      // Peek a mock: the page loads in a scaled, non-interactive frame.
      await linkRow(page, fixture.urls.lavishFirst).getByTestId("chat-link-peek").click();
      const frame = page.getByTestId("chat-link-peek-frame").filter({ visible: true });
      await expect(frame).toBeVisible();
      await expect(frame).toHaveAttribute("data-interactive", "false");
      await expect(
        page.frameLocator('[data-testid="chat-link-peek-frame"]').getByRole("heading", {
          name: "Calm voice settings",
        }),
      ).toBeVisible();
      await expect(page.getByTestId("chat-link-peek-loading")).toHaveCount(0);
      await evidence(page, `chat-links-peek-${width}.png`);
      await page.getByTestId("chat-link-peek-interact").filter({ visible: true }).click();
      await expect(frame).toHaveAttribute("data-interactive", "true");
      await expect(frame).toHaveAttribute("data-scale", "1.000");
      await closePeek(page);
      await expect(frame).toHaveCount(0);

      // GitHub refuses framing, so its peek is the fallback card with Open.
      await openLinksPanel(page);
      await linkRow(page, fixture.urls.pr).click();
      const fallback = page.getByTestId("chat-link-peek-fallback").filter({ visible: true });
      await expect(fallback).toContainText("This page can't be previewed here");
      await expect(fallback).toContainText(fixture.urls.pr);
      await expect(fallback.getByTestId("chat-link-peek-fallback-open")).toBeVisible();
      await evidence(page, `chat-links-fallback-${width}.png`);
      await closePeek(page);
      await expect(fallback).toHaveCount(0);

      // Jump lands on the user's message, which the long reply scrolled out of view.
      const userMessage = page
        .getByTestId("user-message")
        .filter({ hasText: "Mock up the voice assistant settings" })
        .filter({ visible: true });
      await expect(userMessage).not.toBeInViewport();
      await openLinksPanel(page);
      await linkRow(page, fixture.urls.pasted).getByTestId("chat-link-jump").click();
      await expect(userMessage).toBeInViewport();
    } finally {
      await agent.cleanup();
      pages.server.close();
    }
  });
}
