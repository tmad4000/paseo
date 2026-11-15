import type { Page } from "@playwright/test";
import { test, expect } from "../support/fixtures";
import {
  composerLocator,
  expectComposerDraft,
  fillComposerDraft,
  startRunningMockAgent,
  type MockAgentSetup,
} from "../support/helpers/composer";

// The composer toolbar has no button for the alternate send (Queue message while the agent
// runs); a keyboard reaches it with Command/Ctrl+Enter. Below the compact width, a "More
// actions" menu carries it so touch and narrow panes can reach it too.

const SCREENSHOT_DIR = process.env.E2E_COMPOSER_OVERFLOW_SCREENSHOTS;
const DRAFT = "Queue this after the current turn.";

function visibleOverflowButton(page: Page) {
  return page.getByTestId("message-input-overflow-button").filter({ visible: true });
}

function visibleComposerRoot(page: Page) {
  return page.getByTestId("message-input-root").filter({ visible: true }).first();
}

async function startRunningAgentAt(page: Page, width: number): Promise<MockAgentSetup> {
  await page.setViewportSize({ width, height: 800 });
  const setup = await startRunningMockAgent(page, {
    prefix: `composer-overflow-${width}-`,
    model: "one-minute-stream",
    prompt: "Keep running while a message is queued.",
  });
  await fillComposerDraft(page, DRAFT);
  return setup;
}

async function expectQueued(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: "Send queued message now" })).toBeVisible({
    timeout: 10_000,
  });
  await expectComposerDraft(page, "");
}

async function captureComposer(page: Page, name: string): Promise<void> {
  if (!SCREENSHOT_DIR) return;
  await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}.png` });
}

test.describe("Composer More actions menu", () => {
  test.describe.configure({ timeout: 120_000 });

  test("a wide composer keeps its toolbar without a More actions button", async ({ page }) => {
    const setup = await startRunningAgentAt(page, 1280);
    try {
      await expect(visibleComposerRoot(page)).toBeVisible();
      await expect(visibleOverflowButton(page)).toHaveCount(0);
      await captureComposer(page, "wide-1280");
      // The keyboard path is unchanged on wide layouts.
      await composerLocator(page).press("Control+Enter");
      await expectQueued(page);
    } finally {
      await setup.cleanup();
    }
  });

  test("a narrow desktop pane queues from the keyboard through More actions", async ({ page }) => {
    // At 721px the sidebar stays pinned, leaving the chat pane well under the compact width.
    const setup = await startRunningAgentAt(page, 721);
    try {
      const trigger = visibleOverflowButton(page);
      await expect(trigger).toHaveCount(1);
      await expect(trigger).toHaveAccessibleName("More actions");
      await expect(trigger).toHaveAttribute("aria-haspopup", "menu");
      await expect(trigger).toHaveAttribute("aria-expanded", "false");

      await trigger.focus();
      await page.keyboard.press("Enter");
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      const item = page.getByRole("menuitem", { name: "Queue message" });
      await expect(item).toBeVisible();
      await captureComposer(page, "desktop-pane-721-open");

      // Opening from the keyboard moves focus onto the first enabled item.
      await expect(item).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(item).toBeFocused();
      await page.keyboard.press("Enter");
      await expectQueued(page);
      await captureComposer(page, "desktop-pane-721-queued");
    } finally {
      await setup.cleanup();
    }
  });

  test("Escape closes More actions and returns focus to its button", async ({ page }) => {
    const setup = await startRunningAgentAt(page, 721);
    try {
      const trigger = visibleOverflowButton(page);
      await trigger.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("menuitem", { name: "Queue message" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menuitem", { name: "Queue message" })).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await expectComposerDraft(page, DRAFT);
    } finally {
      await setup.cleanup();
    }
  });

  test("mobile web queues by tapping More actions", async ({ page }) => {
    const setup = await startRunningAgentAt(page, 390);
    try {
      const trigger = visibleOverflowButton(page);
      await expect(trigger).toHaveCount(1);
      const rootBox = await visibleComposerRoot(page).boundingBox();
      const triggerBox = await trigger.boundingBox();
      expect(rootBox).not.toBeNull();
      expect(triggerBox).not.toBeNull();
      // The trigger sits inside the composer, not clipped past its right edge.
      expect(triggerBox!.x + triggerBox!.width).toBeLessThanOrEqual(rootBox!.x + rootBox!.width);
      await captureComposer(page, "mobile-390");

      await trigger.click();
      const item = page.getByRole("menuitem", { name: "Queue message" });
      await expect(item).toBeInViewport({ ratio: 1 });
      await captureComposer(page, "mobile-390-open");
      await item.click();
      await expectQueued(page);
    } finally {
      await setup.cleanup();
    }
  });
});
