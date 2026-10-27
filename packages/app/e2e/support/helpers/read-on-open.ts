import type { Page } from "@playwright/test";

/**
 * Opt this page into the legacy "Mark chats read when opened" setting. By default opening,
 * focusing or leaving a chat no longer reads it; flows that assert read-on-open use this.
 */
export async function enableReadOnOpen(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("@paseo:app-settings", JSON.stringify({ markReadOnOpen: true }));
  });
}
