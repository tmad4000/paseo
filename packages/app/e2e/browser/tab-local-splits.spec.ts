import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { buildTerminalWorkspaceUrl, navigateToTerminal } from "../support/helpers/terminal-perf";
import { runWorkspaceActionFromCommandCenter } from "../support/helpers/command-center-workspace-actions";

const COMPOSER = "Message agent...";
const LEAF_TITLES = '[data-testid^="tab-local-leaf-"][data-testid$="-title"]';
const PANES = '[data-testid^="workspace-pane-"]';

test.describe.configure({ timeout: 300_000 });

interface StoredComposite {
  hostTabId: string;
  focusedLeafId: string;
  root: { kind: string; sizes?: number[]; children?: unknown[] };
}

interface Scenario {
  page: Page;
  workspace: SeededWorkspace;
  workspaceKey: string;
  hostAgentId: string;
  hostTabId: string;
  otherTabId: string;
  shellId: string;
  shellTabId: string;
  /** Set once "New terminal" fills a chooser. */
  newTerminalTabId: string;
  shot: (name: string) => Promise<unknown>;
}

function visible(page: Page, testId: string): Locator {
  return page.getByTestId(testId).filter({ visible: true });
}

function chooser(page: Page): Locator {
  return page.locator('[data-testid^="tab-local-chooser-chooser:"]').filter({ visible: true });
}

function composer(page: Page): Locator {
  return page.getByRole("textbox", { name: COMPOSER }).filter({ visible: true });
}

function glyph(s: Scenario): Locator {
  return visible(s.page, `workspace-tab-modified-${s.hostTabId}-tab-local`);
}

function readComposites(page: Page, workspaceKey: string) {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem("tab-local-splits");
    if (!raw) return {};
    const parsed = JSON.parse(raw) as {
      state: { layoutsByWorkspace: Record<string, Record<string, unknown>> };
    };
    return parsed.state.layoutsByWorkspace[key] ?? {};
  }, workspaceKey) as Promise<Record<string, StoredComposite>>;
}

async function readHostComposite(s: Scenario): Promise<StoredComposite | undefined> {
  return (await readComposites(s.page, s.workspaceKey))[s.hostTabId];
}

function readLayoutBlob(page: Page): Promise<string | null> {
  return page.evaluate(() => window.localStorage.getItem("workspace-layout-state"));
}

function layoutBlobMentions(page: Page, ids: string[]): Promise<boolean[]> {
  return page.evaluate((tabIds) => {
    const text = window.localStorage.getItem("workspace-layout-state") ?? "";
    return tabIds.map((id) => text.includes(id));
  }, ids);
}

function visibleStripOrder(page: Page): Promise<(string | null)[]> {
  return page
    .locator('[data-testid^="workspace-tab-"][aria-selected]')
    .filter({ visible: true })
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-testid")));
}

async function listTerminalIds(workspace: SeededWorkspace): Promise<string[]> {
  const result = await workspace.client.listTerminals(workspace.repoPath, undefined, {
    workspaceId: workspace.workspaceId,
  });
  return result.terminals.map((terminal) => terminal.id);
}

async function terminalText(workspace: SeededWorkspace, terminalId: string): Promise<string> {
  const capture = await workspace.client.captureTerminal(terminalId, { stripAnsi: true });
  return capture.lines.join("\n");
}

async function splitFromMenu(page: Page, tabId: string, side: "right" | "below") {
  await visible(page, `workspace-tab-${tabId}`).first().click({ button: "right" });
  await page.getByTestId(`workspace-tab-context-${tabId}-split-this-tab-${side}`).click();
}

async function dragTo(page: Page, from: Locator, to: { x: number; y: number }) {
  const box = await from.boundingBox();
  if (!box) throw new Error("drag source has no box");
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 24, start.y + 4, { steps: 6 });
  await page.mouse.move(to.x, to.y, { steps: 24 });
  await page.mouse.up();
}

async function chooserCreatesNothing(s: Scenario) {
  const terminalsBefore = (await listTerminalIds(s.workspace)).length;
  const agentsBefore = (await s.workspace.client.fetchAgents()).entries.length;
  await splitFromMenu(s.page, s.hostTabId, "right");
  await expect(chooser(s.page)).toHaveCount(1);
  await expect(visible(s.page, `tab-local-composite-${s.hostTabId}`)).toBeVisible();
  await s.shot("01-chooser-right");
  expect((await listTerminalIds(s.workspace)).length).toBe(terminalsBefore);
  expect((await s.workspace.client.fetchAgents()).entries.length).toBe(agentsBefore);
}

async function escapeCancels(s: Scenario) {
  await s.page.keyboard.press("Escape");
  await expect(chooser(s.page)).toHaveCount(0);
  await expect(s.page.getByTestId(`tab-local-composite-${s.hostTabId}`)).toHaveCount(0);
  await expect(s.page.getByTestId(`workspace-tab-modified-${s.hostTabId}-tab-local`)).toHaveCount(
    0,
  );
}

async function existingTerminalJoins(s: Scenario) {
  await composer(s.page).click();
  await s.page.keyboard.press("Control+Alt+Backslash");
  await expect(chooser(s.page)).toHaveCount(1);
  await s.page.getByTestId(`tab-local-chooser-existing-${s.shellTabId}`).click();
  await expect(visible(s.page, `tab-local-leaf-${s.shellTabId}`)).toBeVisible();
  await expect(visible(s.page, `workspace-tab-${s.shellTabId}`)).toHaveCount(0);
  await expect(glyph(s)).toHaveText("2");
  const surface = visible(s.page, `tab-local-leaf-${s.shellTabId}`).getByTestId("terminal-surface");
  await expect(surface).toBeVisible({ timeout: 15_000 });
  await surface.click();
  await surface.locator(".xterm-helper-textarea").pressSequentially("echo TLS_LEAF_ROUND_TRIP\n");
  await expect.poll(() => terminalText(s.workspace, s.shellId)).toContain("TLS_LEAF_ROUND_TRIP\n");
  await s.shot("02-terminal-leaf");
}

async function newTerminalFromTerminalLeaf(s: Scenario) {
  const before = await listTerminalIds(s.workspace);
  // Focus is inside the terminal; the shortcut must not be swallowed by it.
  await s.page.keyboard.press("Control+Alt+Shift+Backslash");
  await expect(chooser(s.page)).toHaveCount(1);
  await s.page.getByTestId("tab-local-chooser-new-terminal").click();
  await expect
    .poll(async () => (await listTerminalIds(s.workspace)).length)
    .toBe(before.length + 1);
  const created = (await listTerminalIds(s.workspace)).find((id) => !before.includes(id));
  s.newTerminalTabId = `terminal_${created}`;
  await expect(visible(s.page, `tab-local-leaf-${s.newTerminalTabId}`)).toBeVisible({
    timeout: 20_000,
  });
  await expect(visible(s.page, `workspace-tab-${s.newTerminalTabId}`)).toHaveCount(0);
  await expect(glyph(s)).toHaveText("3");
  await expect(s.page.locator(LEAF_TITLES)).toHaveCount(3);
  await s.shot("03-three-leaves");
  await visible(s.page, `workspace-tab-${s.hostTabId}`).first().hover();
  await expect(s.page.getByTestId(`workspace-tab-tooltip-${s.hostTabId}`)).toContainText(
    "3 views in this tab",
  );
  await s.shot("04-strip-chip-tooltip");
}

async function resizePersistsAcrossReload(s: Scenario) {
  const blobBefore = await readLayoutBlob(s.page);
  const box = await s.page.locator('[data-testid^="tab-local-divider-"]').first().boundingBox();
  if (!box) throw new Error("no divider");
  // A quarter down, clear of the nested divider that starts at the middle of this one.
  const y = box.y + box.height / 4;
  await s.page.mouse.move(box.x + box.width / 2, y);
  await s.page.mouse.down();
  await s.page.mouse.move(box.x + box.width / 2 - 140, y, { steps: 12 });
  await s.page.mouse.up();
  await expect.poll(async () => (await readHostComposite(s))?.root.sizes?.[0]).toBeLessThan(0.45);
  const stored = await readHostComposite(s);
  expect(await readLayoutBlob(s.page)).toBe(blobBefore);
  await s.page.reload();
  await expect(visible(s.page, `tab-local-composite-${s.hostTabId}`)).toBeVisible({
    timeout: 30_000,
  });
  await expect(s.page.locator(LEAF_TITLES)).toHaveCount(3);
  expect((await readHostComposite(s))?.root).toEqual(stored?.root);
  await s.shot("05-after-reload");
}

async function switchingTabsKeepsComposite(s: Scenario) {
  await composer(s.page).first().click();
  await composer(s.page).first().fill("unsent draft survives");
  const focusedBefore = (await readHostComposite(s))?.focusedLeafId;
  await visible(s.page, `workspace-tab-${s.otherTabId}`).first().click();
  await expect(visible(s.page, `tab-local-composite-${s.hostTabId}`)).toHaveCount(0);
  await visible(s.page, `workspace-tab-${s.hostTabId}`).first().click();
  await expect(visible(s.page, `tab-local-composite-${s.hostTabId}`)).toBeVisible();
  await expect(s.page.locator(LEAF_TITLES).filter({ visible: true })).toHaveCount(3);
  expect((await readHostComposite(s))?.focusedLeafId).toBe(focusedBefore);
  await expect(
    visible(s.page, `tab-local-leaf-${s.hostTabId}`).getByRole("textbox", { name: COMPOSER }),
  ).toHaveValue("unsent draft survives");
}

async function zoomToggles(s: Scenario) {
  await visible(s.page, `tab-local-leaf-${s.shellTabId}-title`).click();
  await s.page.keyboard.press("Control+Shift+Enter");
  await expect(s.page.locator(LEAF_TITLES).filter({ visible: true })).toHaveCount(1);
  await expect(visible(s.page, `tab-local-leaf-${s.shellTabId}-title`)).toBeVisible();
  await s.shot("06-zoomed");
  await s.page.keyboard.press("Control+Shift+Enter");
  await expect(s.page.locator(LEAF_TITLES).filter({ visible: true })).toHaveCount(3);
}

async function focusWalksLeavesThenPanes(s: Scenario) {
  const focusedLeaf = async () => (await readHostComposite(s))?.focusedLeafId;
  await runWorkspaceActionFromCommandCenter(s.page, "Split pane right");
  await expect(s.page.locator(PANES).filter({ visible: true })).toHaveCount(2, { timeout: 15_000 });
  await visible(s.page, `tab-local-leaf-${s.hostTabId}-title`).click();
  await expect.poll(focusedLeaf).toBe(s.hostTabId);
  await runWorkspaceActionFromCommandCenter(s.page, "Focus pane right");
  await expect.poll(focusedLeaf).not.toBe(s.hostTabId);
  const middle = await focusedLeaf();
  expect([s.shellTabId, s.newTerminalTabId]).toContain(middle);
  // From the composite's right column, right leaves the composite for the new pane, and left
  // comes back to the same leaf. Had focus stayed inside, left would land on the agent leaf.
  await runWorkspaceActionFromCommandCenter(s.page, "Focus pane right");
  await expect.poll(focusedLeaf).toBe(middle);
  await runWorkspaceActionFromCommandCenter(s.page, "Focus pane left");
  await expect.poll(focusedLeaf).toBe(middle);
  await runWorkspaceActionFromCommandCenter(s.page, "Focus pane left");
  await expect.poll(focusedLeaf).toBe(s.hostTabId);
  await s.shot("07-focus-walk");
  // Outside a composite, Zoom leaf falls through to Maximize pane.
  await visible(s.page, `workspace-tab-${s.otherTabId}`).first().click();
  await s.page.keyboard.press("Control+Shift+Enter");
  await expect(visible(s.page, "workspace-restore-pane")).toHaveCount(1);
  await s.page.keyboard.press("Control+Shift+Enter");
  await expect(visible(s.page, "workspace-restore-pane")).toHaveCount(0);
}

async function deepLinkFocusesMemberLeaf(s: Scenario) {
  await visible(s.page, `workspace-tab-${s.otherTabId}`).first().click();
  await s.page.goto(buildTerminalWorkspaceUrl(s.workspace.workspaceId, s.shellId));
  await expect(visible(s.page, `tab-local-composite-${s.hostTabId}`)).toBeVisible({
    timeout: 30_000,
  });
  await expect.poll(async () => (await readHostComposite(s))?.focusedLeafId).toBe(s.shellTabId);
  await expect(s.page.locator(`[data-testid="workspace-tab-${s.shellTabId}"]`)).toHaveCount(0);
  await expect(visible(s.page, `workspace-tab-${s.hostTabId}`)).toHaveAttribute(
    "aria-selected",
    "true",
  );
}

async function dragHostToPaneEdgeAndBack(s: Scenario) {
  const panes = s.page.locator(PANES).filter({ visible: true });
  const paneCount = await panes.count();
  const hostPane = panes.filter({ has: s.page.getByTestId(`tab-local-composite-${s.hostTabId}`) });
  const paneBox = await hostPane.first().boundingBox();
  if (!paneBox) throw new Error("no pane box");
  await dragTo(s.page, visible(s.page, `workspace-tab-${s.hostTabId}`).first(), {
    x: paneBox.x + paneBox.width - 30,
    y: paneBox.y + paneBox.height / 2,
  });
  await expect(panes).toHaveCount(paneCount + 1, { timeout: 15_000 });
  await expect(visible(s.page, `tab-local-composite-${s.hostTabId}`)).toBeVisible();
  await expect(s.page.locator(LEAF_TITLES).filter({ visible: true })).toHaveCount(3);
  await expect
    .poll(() => layoutBlobMentions(s.page, [s.hostTabId, s.shellTabId, s.newTerminalTabId]))
    .toEqual([true, true, true]);
  await s.shot("08-composite-in-new-pane");
  const otherBox = await visible(s.page, `workspace-tab-${s.otherTabId}`).first().boundingBox();
  if (!otherBox) throw new Error("no strip");
  await dragTo(s.page, visible(s.page, `workspace-tab-${s.hostTabId}`).first(), {
    x: otherBox.x + otherBox.width - 6,
    y: otherBox.y + otherBox.height / 2,
  });
  await expect(panes).toHaveCount(paneCount, { timeout: 15_000 });
  await expect(glyph(s)).toHaveText("3");
  await expect(
    panes.filter({ has: s.page.getByTestId(`workspace-tab-${s.otherTabId}`) }),
  ).toContainText("Build home");
}

async function moveLeafToOwnTab(s: Scenario) {
  await visible(s.page, `tab-local-leaf-${s.newTerminalTabId}-menu`).click();
  await s.page.getByTestId(`tab-local-leaf-${s.newTerminalTabId}-move-to-own-tab`).click();
  await expect(visible(s.page, `workspace-tab-${s.newTerminalTabId}`)).toBeVisible();
  await expect(glyph(s)).toHaveText("2");
  const order = await visibleStripOrder(s.page);
  expect(order.indexOf(`workspace-tab-${s.newTerminalTabId}`)).toBe(
    order.indexOf(`workspace-tab-${s.hostTabId}`) + 1,
  );
  expect(await listTerminalIds(s.workspace)).toContain(s.newTerminalTabId.replace("terminal_", ""));
  await s.shot("09-moved-to-own-tab");
}

// Leaf × uses the tab's own close policy, unchanged: a root agent's tab archives on close,
// exactly like the strip's ×.
async function leafCloseUsesTabPolicy(s: Scenario) {
  await visible(s.page, `workspace-tab-${s.hostTabId}`).first().click();
  await splitFromMenu(s.page, s.hostTabId, "below");
  await s.page.getByTestId(`tab-local-chooser-existing-${s.otherTabId}`).click();
  await expect(visible(s.page, `tab-local-leaf-${s.otherTabId}`)).toBeVisible();
  await visible(s.page, `tab-local-leaf-${s.otherTabId}-close`).click();
  await expect(s.page.getByTestId(`tab-local-leaf-${s.otherTabId}`)).toHaveCount(0, {
    timeout: 15_000,
  });
  await expect(s.page.getByTestId(`workspace-tab-${s.otherTabId}`)).toHaveCount(0);
  await expect(visible(s.page, `tab-local-leaf-${s.hostTabId}`)).toBeVisible();
}

async function compactFlattensAndRestores(s: Scenario) {
  await s.page.setViewportSize({ width: 600, height: 900 });
  await expect(visible(s.page, `tab-local-composite-${s.hostTabId}`)).toHaveCount(0, {
    timeout: 15_000,
  });
  await s.shot("10-compact");
  await s.page.setViewportSize({ width: 1500, height: 950 });
  await expect(visible(s.page, `tab-local-composite-${s.hostTabId}`)).toBeVisible({
    timeout: 15_000,
  });
}

async function hostCloseClosesMembers(s: Scenario) {
  // Each member's own confirmation (here: closing a running terminal) is accepted.
  s.page.on("dialog", (dialog) => void dialog.accept());
  await visible(s.page, `workspace-tab-${s.hostTabId}`).first().hover();
  await visible(s.page, `workspace-agent-close-${s.hostAgentId}`).click();
  await expect(s.page.getByTestId(`tab-local-leaf-${s.shellTabId}`)).toHaveCount(0, {
    timeout: 15_000,
  });
  await expect(s.page.getByTestId(`workspace-tab-${s.hostTabId}`)).toHaveCount(0, {
    timeout: 15_000,
  });
  await expect.poll(() => readComposites(s.page, s.workspaceKey)).toEqual({});
  // The terminal broken out earlier is untouched.
  await expect(visible(s.page, `workspace-tab-${s.newTerminalTabId}`)).toBeVisible();
}

let workspace: SeededWorkspace;

test.beforeAll(async () => {
  workspace = await seedWorkspace({ repoPrefix: "tab-local-splits-" });
});

test.afterAll(async () => {
  await workspace?.cleanup();
});

test("Split this tab: chooser, leaves, zoom, focus, moves and close", async ({ page }) => {
  const createAgent = (title: string) =>
    workspace.client.createAgent({
      provider: "mock",
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title,
      modeId: "load-test",
      model: "e2e-fast-stream",
    });
  const hostAgent = await createAgent("Build homepage");
  const otherAgent = await createAgent("Second session");
  for (const id of [hostAgent.id, otherAgent.id]) {
    await workspace.client.waitForAgentUpsert(id, (snapshot) => snapshot.status === "idle");
  }
  const shell = await workspace.client.createTerminal(workspace.repoPath, "Shell", undefined, {
    workspaceId: workspace.workspaceId,
  });
  if (!shell.terminal) throw new Error(`terminal: ${shell.error}`);
  const s: Scenario = {
    page,
    workspace,
    workspaceKey: `${getServerId()}:${workspace.workspaceId}`,
    hostAgentId: hostAgent.id,
    hostTabId: `agent_${hostAgent.id}`,
    otherTabId: `agent_${otherAgent.id}`,
    shellId: shell.terminal.id,
    shellTabId: `terminal_${shell.terminal.id}`,
    newTerminalTabId: "",
    shot: (name) => page.screenshot({ path: test.info().outputPath(`${name}.png`) }),
  };

  await page.setViewportSize({ width: 1500, height: 950 });
  await navigateToTerminal(page, { workspaceId: workspace.workspaceId, terminalId: s.shellId });
  await visible(page, `workspace-tab-${s.hostTabId}`).first().click();
  await expect(composer(page)).toBeEditable({ timeout: 30_000 });

  await test.step("Split this tab > Right opens a chooser, creates nothing", () =>
    chooserCreatesNothing(s));
  await test.step("Esc cancels back to one view", () => escapeCancels(s));
  await test.step("Ctrl+Alt+\\ then Existing tab: a terminal leaf", () => existingTerminalJoins(s));
  await test.step("Ctrl+Alt+Shift+\\ from the terminal, New terminal: three leaves", () =>
    newTerminalFromTerminalLeaf(s));
  await test.step("divider ratios persist; layout blob untouched", () =>
    resizePersistsAcrossReload(s));
  await test.step("switching tabs keeps leaves, focus and draft", () =>
    switchingTabsKeepsComposite(s));
  await test.step("Ctrl+Shift+Enter zooms and restores", () => zoomToggles(s));
  await test.step("focus walks leaves, then panes; zoom falls through to maximize", () =>
    focusWalksLeavesThenPanes(s));
  await test.step("deep link to a member focuses its leaf in the host", () =>
    deepLinkFocusesMemberLeaf(s));
  await test.step("host chip to a pane edge and back: members follow", () =>
    dragHostToPaneEdgeAndBack(s));
  await test.step("Move to its own tab", () => moveLeafToOwnTab(s));
  await test.step("leaf × uses the tab's close policy", () => leafCloseUsesTabPolicy(s));
  await test.step("compact flattens; wide restores", () => compactFlattensAndRestores(s));
  await test.step("closing the host closes its members", () => hostCloseClosesMembers(s));
});
