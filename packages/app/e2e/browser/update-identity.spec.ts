import { expect, test, type Page } from "../support/fixtures";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { openSettingsSection } from "../support/helpers/settings";

const IDENTITY = "Paseo Fork 0.10.0-beta.33 · beta channel · from tmad4000/paseo";
const RELEASE_NOTES = "https://github.com/tmad4000/paseo/releases/tag/0.10.0-beta.33";
const RESTART =
  "Local agents and terminals stop during the restart, even with Keep daemon running after quit on. The daemon restarts with the app.";

// The browser has no Electron shell, so answer the desktop IPC the update
// surfaces read: a packaged fork build on the beta channel with a downloaded
// update, and a daemon this app launched.
async function installFakeDesktopShell(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const responses: Record<string, unknown> = {
      get_desktop_settings: {
        releaseChannel: "beta",
        notifications: { playSound: true },
        daemon: { manageBuiltInDaemon: false, keepRunningAfterQuit: true },
      },
      desktop_get_runtime_info: {
        appVersion: "0.10.0-beta.32",
        runningUnderARM64Translation: false,
        productName: "Paseo Fork",
        updateSource: { owner: "tmad4000", repo: "paseo" },
      },
      check_app_update: {
        hasUpdate: true,
        readyToInstall: true,
        currentVersion: "0.10.0-beta.32",
        latestVersion: "0.10.0-beta.33",
        publishedVersion: "0.10.0-beta.33",
        publishedTag: "0.10.0-beta.33",
        body: null,
        date: null,
        errorMessage: null,
      },
      desktop_daemon_status: {
        serverId: "srv_desktop_owned",
        status: "running",
        listen: null,
        hostname: null,
        pid: 4242,
        home: "",
        version: "0.10.0-beta.32",
        desktopManaged: true,
        ownedByDesktop: true,
        startedAt: null,
        error: null,
      },
      desktop_daemon_logs: { logPath: "", contents: "" },
    };
    (window as unknown as { paseoDesktop: unknown }).paseoDesktop = {
      platform: "linux",
      invoke: async (command: string) => responses[command] ?? null,
      getPendingOpenProject: async () => null,
      events: { on: async () => () => undefined },
    };
  });
}

test("names the fork build, its release notes and the restart effect on update surfaces", async ({
  page,
}, testInfo) => {
  await installFakeDesktopShell(page);
  await gotoAppShell(page);

  await test.step("sidebar update callout", async () => {
    const callout = page.getByTestId("update-callout");
    await expect(callout).toContainText(IDENTITY);
    await expect(callout).toContainText(RESTART);
    await page.screenshot({ path: testInfo.outputPath("sidebar-update-callout.png") });
  });

  await test.step("Help menu", async () => {
    await page.getByTestId("sidebar-help").click();
    const menu = page.getByTestId("sidebar-help-menu");
    await expect(menu).toHaveCSS("opacity", "1");
    await expect(page.getByTestId("sidebar-help-update-identity")).toHaveText(IDENTITY);
    await expect(page.getByTestId("sidebar-help-update-restart")).toHaveText(RESTART);
    await expect(page.getByTestId("sidebar-help-update-release-notes")).toHaveText(
      /What's new in 0\.10\.0-beta\.33/,
    );
    await expect(page.getByTestId("sidebar-help-version-number")).toHaveText(/^Paseo Fork\s*v/);
    await page.screenshot({ path: testInfo.outputPath("help-menu-update.png") });
    await page.keyboard.press("Escape");
  });

  await test.step("Fork badge menu", async () => {
    await page.getByTestId("fork-version-trigger").click();
    await expect(page.getByTestId("fork-version-menu")).toHaveCSS("opacity", "1");
    await expect(page.getByTestId("fork-update-identity")).toHaveText(IDENTITY);
    await expect(page.getByTestId("fork-release-notes")).toHaveText(
      /What's new in 0\.10\.0-beta\.33/,
    );
    await page.screenshot({ path: testInfo.outputPath("fork-badge-menu.png") });
    await page.keyboard.press("Escape");
  });

  await test.step("Settings → App updates", async () => {
    await openSettings(page);
    await openSettingsSection(page, "about");
    await expect(page.getByTestId("settings-update-identity")).toHaveText(IDENTITY);
    await expect(page.getByTestId("settings-update-restart")).toHaveText(RESTART);
    const releaseNotes = page.getByTestId("settings-update-release-notes");
    await expect(releaseNotes).toContainText("What's new in 0.10.0-beta.33");
    await expect(releaseNotes).toContainText(RELEASE_NOTES.replace("https://", ""));
    await page.screenshot({
      path: testInfo.outputPath("settings-app-updates.png"),
      fullPage: true,
    });
  });
});
