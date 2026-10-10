import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import { seedParentWithSubagent, type SeededSubagentPair } from "../support/helpers/subagents";

const CHECKLIST_URL = "https://checklist.paseo-e2e.test/morning-review";
const CHECKLIST_HTML =
  "<!doctype html><title>Morning review</title><h1>Morning review</h1><label><input type=checkbox> Ship drawer</label>";

const PARENT_COMPOSER = "Message agent...";

async function lastUserMessageAt(workspace: SeededWorkspace, agentId: string) {
  const result = await workspace.client.fetchAgent({ agentId });
  // The seed client types only the fields its other callers read; the snapshot carries this one.
  const agent = result?.agent as { lastUserMessageAt?: string | null } | undefined;
  return agent?.lastUserMessageAt ?? null;
}

async function seedIdlePair(
  workspace: SeededWorkspace,
  titles: { parentTitle: string; childTitle: string },
): Promise<SeededSubagentPair> {
  const agents = await seedParentWithSubagent(workspace, titles);
  await workspace.client.waitForAgentUpsert(agents.child.id, (s) => s.status === "idle");
  await workspace.client.waitForAgentUpsert(agents.parent.id, (s) => s.status === "idle");
  return agents;
}

async function screenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: test.info().outputPath(`${name}.png`) });
}

test.describe("Subagents drawer", () => {
  let workspace: SeededWorkspace;

  test.beforeAll(async () => {
    workspace = await seedWorkspace({ repoPrefix: "subthreads-drawer-" });
  });

  test.afterAll(async () => {
    await workspace?.cleanup();
  });

  test("reads and replies to a subagent beside its parent, reaching only the child", async ({
    page,
  }) => {
    const agents = await seedIdlePair(workspace, {
      parentTitle: "Release orchestrator",
      childTitle: "Fix flaky login test",
    });
    await openAgentRoute(page, { workspaceId: agents.workspaceId, agentId: agents.parent.id });

    await page.getByTestId("subthreads-open").click();
    const drawer = page.getByTestId("subthreads-drawer");
    await expect(drawer).toBeVisible({ timeout: 30_000 });
    await expect(drawer.getByTestId("subthreads-summary")).toHaveText("1 subagent");
    const row = drawer.getByTestId(`subthreads-row-${agents.child.id}`);
    await expect(row).toBeVisible();
    await screenshot(page, "desktop-list");

    await row.click();
    await expect(drawer.getByTestId("subthreads-target-title")).toHaveText("Fix flaky login test");
    await expect(drawer.getByTestId("subthreads-target-path")).toContainText(
      "Release orchestrator",
    );
    const reply = drawer.getByRole("textbox", { name: "Reply to Fix flaky login test" });
    await expect(reply).toBeEditable({ timeout: 30_000 });
    // The parent stays on screen, with its own composer, while the subagent is open.
    await expect(page.getByRole("textbox", { name: PARENT_COMPOSER })).toBeVisible();
    await screenshot(page, "desktop-thread");

    await reply.fill("Check the retry path");
    await reply.press("Enter");

    await expect
      .poll(() => lastUserMessageAt(workspace, agents.child.id), { timeout: 30_000 })
      .not.toBeNull();
    expect(await lastUserMessageAt(workspace, agents.parent.id)).toBeNull();
    await expect(drawer.getByText("Check the retry path").first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test("the shortcut moves typing between the parent and the drawer", async ({ page }) => {
    const agents = await seedIdlePair(workspace, {
      parentTitle: "Keyboard orchestrator",
      childTitle: "Keyboard child",
    });
    await openAgentRoute(page, { workspaceId: agents.workspaceId, agentId: agents.parent.id });
    const parentComposer = page.getByRole("textbox", { name: PARENT_COMPOSER });
    await expect(parentComposer).toBeEditable({ timeout: 30_000 });
    await parentComposer.click();

    await page.keyboard.press("ControlOrMeta+Shift+J");
    const drawer = page.getByTestId("subthreads-drawer");
    const row = drawer.getByTestId(`subthreads-row-${agents.child.id}`);
    await expect(row).toBeFocused();

    await page.keyboard.press("Enter");
    const reply = drawer.getByRole("textbox", { name: "Reply to Keyboard child" });
    await expect(reply).toBeFocused({ timeout: 30_000 });
    await page.keyboard.type("draft for the child");
    await expect(parentComposer).toHaveValue("");

    await page.keyboard.press("ControlOrMeta+Shift+J");
    await expect(drawer).toBeHidden();
    await expect(parentComposer).toBeFocused();
    expect(await lastUserMessageAt(workspace, agents.child.id)).toBeNull();
    expect(await lastUserMessageAt(workspace, agents.parent.id)).toBeNull();
  });

  test("covers the parent on a phone and returns to it on close", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const agents = await seedIdlePair(workspace, {
      parentTitle: "Phone orchestrator",
      childTitle: "Phone child",
    });
    await openAgentRoute(page, { workspaceId: agents.workspaceId, agentId: agents.parent.id });

    await page.getByTestId("subthreads-open").click();
    const drawer = page.getByTestId("subthreads-drawer");
    await drawer.getByTestId(`subthreads-row-${agents.child.id}`).click();
    await expect(drawer.getByRole("textbox", { name: "Reply to Phone child" })).toBeEditable({
      timeout: 30_000,
    });
    await screenshot(page, "phone-thread");

    await drawer.getByTestId("subthreads-close").click();
    await expect(drawer).toBeHidden();
    await expect(page.getByRole("textbox", { name: PARENT_COMPOSER })).toBeVisible();
  });

  test("an agent shows a checklist beside the conversation through session labels", async ({
    page,
  }) => {
    await page.route(`${CHECKLIST_URL}**`, (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: CHECKLIST_HTML }),
    );
    const agents = await seedIdlePair(workspace, {
      parentTitle: "Checklist orchestrator",
      childTitle: "Checklist child",
    });
    await openAgentRoute(page, { workspaceId: agents.workspaceId, agentId: agents.parent.id });
    const parentComposer = page.getByRole("textbox", { name: PARENT_COMPOSER });
    await expect(parentComposer).toBeEditable({ timeout: 30_000 });
    await parentComposer.fill("still my draft");
    const routeBefore = page.url();

    // The same labels `paseo agent update --label` and the MCP `update_agent` tool write.
    await workspace.client.updateAgent(agents.parent.id, {
      labels: { "paseo.checklist-url": CHECKLIST_URL, "paseo.side-panel": "checklist" },
    });

    const panel = page.getByTestId("session-checklist-panel");
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByTestId("session-checklist-source")).toContainText(
      "checklist.paseo-e2e.test",
    );
    await expect(
      page.frameLocator('[data-testid="session-checklist-frame"]').getByRole("heading", {
        name: "Morning review",
      }),
    ).toBeVisible({ timeout: 30_000 });
    // Beside, not instead: same route, the parent chat and its draft are untouched.
    expect(page.url()).toBe(routeBefore);
    await expect(parentComposer).toBeVisible();
    await expect(parentComposer).toHaveValue("still my draft");
    const parentBox = await parentComposer.boundingBox();
    const panelBox = await panel.boundingBox();
    expect(parentBox && panelBox && parentBox.x + parentBox.width <= panelBox.x + 1).toBe(true);
    await screenshot(page, "desktop-checklist-split");

    // The choice is the session's: it survives a reload.
    await page.reload();
    await expect(page.getByTestId("session-checklist-panel")).toBeVisible({ timeout: 60_000 });

    // The subagents are one switch away in the same panel, never a second competing pane.
    await page.getByTestId("session-side-panel-mode-subagents").click();
    await expect(page.getByTestId(`subthreads-row-${agents.child.id}`)).toBeVisible();
    await expect(page.getByTestId("session-checklist-panel")).toBeHidden();
    await expect
      .poll(async () => {
        const result = await workspace.client.fetchAgent({ agentId: agents.parent.id });
        const agent = result?.agent as { labels?: Record<string, string> } | undefined;
        return agent?.labels?.["paseo.side-panel"] ?? null;
      })
      .toBe("subagents");

    await workspace.client.updateAgent(agents.parent.id, { labels: { "paseo.side-panel": "" } });
    await expect(page.getByTestId("subthreads-drawer")).toBeHidden({ timeout: 30_000 });
  });

  test("ui.tab.open with side placement opens beside the chat without moving focus", async ({
    page,
  }) => {
    await writeFile(path.join(workspace.repoPath, "CHECKLIST.md"), "# Checklist\n\n- [ ] Ship\n");
    const agents = await seedIdlePair(workspace, {
      parentTitle: "Placement orchestrator",
      childTitle: "Placement child",
    });
    await openAgentRoute(page, { workspaceId: agents.workspaceId, agentId: agents.parent.id });
    const parentComposer = page.getByRole("textbox", { name: PARENT_COMPOSER });
    await expect(parentComposer).toBeEditable({ timeout: 30_000 });
    await parentComposer.click();
    await parentComposer.fill("mid-sentence");
    const routeBefore = page.url();

    // What `open_tab` (MCP) and `paseo ui open-tab --side` send.
    const opened = await workspace.client.openWorkspaceTab({
      workspaceId: agents.workspaceId,
      target: { kind: "file", path: "CHECKLIST.md" },
      placement: "side",
    });
    expect(opened.error).toBeNull();
    expect(opened.deliveredTo).toBeGreaterThan(0);

    const fileTab = page.getByText("CHECKLIST.md", { exact: true }).first();
    await expect(fileTab).toBeVisible({ timeout: 30_000 });
    const composerBox = await parentComposer.boundingBox();
    const fileTabBox = await fileTab.boundingBox();
    expect(composerBox && fileTabBox && fileTabBox.x >= composerBox.x + composerBox.width).toBe(
      true,
    );
    expect(page.url()).toBe(routeBefore);
    await expect(parentComposer).toBeFocused();
    await expect(parentComposer).toHaveValue("mid-sentence");

    // A checklist page by URL: same side pane, stable tab per URL (browser panes render in the
    // desktop app; the web build shows the tab with its unavailable notice).
    const pageOpen = {
      workspaceId: agents.workspaceId,
      target: { kind: "browser" as const, url: CHECKLIST_URL },
      placement: "side" as const,
    };
    expect((await workspace.client.openWorkspaceTab(pageOpen)).error).toBeNull();
    expect((await workspace.client.openWorkspaceTab(pageOpen)).error).toBeNull();
    await expect(page.getByText("checklist.paseo-e2e.test", { exact: true })).toHaveCount(1, {
      timeout: 30_000,
    });
    await expect(parentComposer).toBeFocused();
    expect(page.url()).toBe(routeBefore);
    await screenshot(page, "desktop-side-placement");
  });
});
