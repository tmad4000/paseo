import path from "node:path";
import { mkdir } from "node:fs/promises";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { expect, test as base, type Page } from "../support/fixtures";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";

const REFERENCE = "Reference project";
const FAVORITE = "Frequent project";
type Observer = Pick<DaemonClient, "connect" | "close" | "listProjects">;
interface Projects {
  reference: SeededWorkspace;
  favorite: SeededWorkspace;
  observer: Observer;
}
const test = base.extend<{ projects: Projects }>({
  projects: async ({ page: _page }, provide) => {
    const reference = await seedWorkspace({ repoPrefix: "picker-reference-", git: false });
    const favorite = await seedWorkspace({ repoPrefix: "picker-favorite-", git: false });
    const observer = await connectDaemonClient<Observer>({ clientIdPrefix: "picker-pin-observer" });
    try {
      await reference.client.renameProject(reference.projectId, REFERENCE);
      await favorite.client.renameProject(favorite.projectId, FAVORITE);
      await provide({ reference, favorite, observer });
    } finally {
      await observer.close();
      await favorite.cleanup();
      await reference.cleanup();
    }
  },
});
async function openNew(page: Page, projects: Projects) {
  const query = new URLSearchParams({
    serverId: getServerId(),
    projectId: projects.reference.projectId,
  });
  await page.goto(`/new?${query}`);
  const trigger = page.getByTestId("new-workspace-project-picker-trigger");
  await expect(trigger).toContainText(REFERENCE);
  await trigger.click();
  await expect(page.getByPlaceholder("Search projects")).toBeVisible();
  return trigger;
}
async function expectStoredPin(projects: Projects, pinned: boolean) {
  await expect
    .poll(async () => {
      const project = (await projects.observer.listProjects()).projects.find(
        (p) => p.projectId === projects.favorite.projectId,
      );
      return Boolean(project?.projectPinnedAt);
    })
    .toBe(pinned);
}
async function screenshot(page: Page, name: string) {
  const file = path.resolve("test-results", name);
  await mkdir(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, animations: "disabled", fullPage: true });
}

test("New workspace and Quick launch share persistent pins without selecting on Enter or Space", async ({
  page,
  projects,
}) => {
  const trigger = await openNew(page, projects);
  const pin = page.getByRole("button", { name: `Pin project: ${FAVORITE}`, exact: true });
  await expect(pin).toBeVisible();
  await pin.focus();
  await expect(pin).toBeFocused();
  await page.keyboard.press("Enter");
  const unpin = page.getByRole("button", { name: `Unpin project: ${FAVORITE}`, exact: true });
  await expect(unpin).toBeVisible();
  await expect(unpin).toBeFocused();
  await expect(trigger).toContainText(REFERENCE);
  await expectStoredPin(projects, true);
  await expect(page.getByTestId("project-picker-section-pinned")).toBeVisible();
  const rows = page.locator('[data-testid^="new-workspace-project-picker-option-"]');
  const favoriteBox = await rows.filter({ hasText: FAVORITE }).boundingBox();
  const referenceBox = await rows.filter({ hasText: REFERENCE }).boundingBox();
  expect(favoriteBox!.y).toBeLessThan(referenceBox!.y);
  await unpin.hover();
  await expect(page.getByText("Unpin project", { exact: true })).toBeVisible();
  await screenshot(page, "project-picker-pins-desktop.png");
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+Shift+L");
  const quickTrigger = page.getByTestId("quick-launch-project-trigger");
  await expect(quickTrigger).toBeVisible();
  const selected = await quickTrigger.innerText();
  await quickTrigger.click();
  const quickUnpin = page.getByRole("button", { name: `Unpin project: ${FAVORITE}`, exact: true });
  await expect(quickUnpin).toBeVisible();
  await quickUnpin.focus();
  await page.keyboard.press("Enter");
  const quickPin = page.getByRole("button", { name: `Pin project: ${FAVORITE}`, exact: true });
  await expect(quickPin).toBeVisible();
  await expect(quickPin).toBeFocused();
  await expect(quickTrigger).toHaveText(selected);
  await expectStoredPin(projects, false);
  await page.keyboard.press("Space");
  await expect(quickUnpin).toBeVisible();
  await expectStoredPin(projects, true);
  await expect(quickTrigger).toHaveText(selected);
  await screenshot(page, "project-picker-pins-quick-launch.png");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await openNew(page, projects);
  await expect(
    page.getByRole("button", { name: `Unpin project: ${FAVORITE}`, exact: true }),
  ).toBeVisible();
  await expectStoredPin(projects, true);
});

test.describe("compact touch project picker", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test("pin tap has a full target and keeps New workspace on its selected project", async ({
    page,
    projects,
  }) => {
    const trigger = await openNew(page, projects);
    const pin = page.getByRole("button", { name: `Pin project: ${FAVORITE}`, exact: true });
    const box = await pin.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(40);
    expect(box!.height).toBeGreaterThanOrEqual(40);
    await pin.tap();
    const unpin = page.getByRole("button", { name: `Unpin project: ${FAVORITE}`, exact: true });
    await expect(unpin).toBeVisible();
    await expect(trigger).toContainText(REFERENCE);
    await expectStoredPin(projects, true);
    await screenshot(page, "project-picker-pins-compact.png");
    await unpin.tap();
    await expect(pin).toBeVisible();
    await expect(trigger).toContainText(REFERENCE);
    await expectStoredPin(projects, false);
  });
});
