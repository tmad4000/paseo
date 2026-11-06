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

/**
 * Seed app settings for this page on every navigation. Pass every setting the flow needs in
 * one call: like `enableReadOnOpen`, each call replaces the stored settings object.
 */
export async function seedAppSettings(
  page: Page,
  settings: Record<string, unknown>,
): Promise<void> {
  await page.addInitScript((value) => {
    localStorage.setItem("@paseo:app-settings", JSON.stringify(value));
  }, settings);
}
