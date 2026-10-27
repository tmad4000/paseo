import { overrideServerInfoFeatures } from "../support/helpers/server-info-features";
import type { Page } from "@playwright/test";
import { test as base, expect } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import {
  openAgentRoute,
  seedMockAgentWorkspace,
  type MockAgentWorkspace,
} from "../support/helpers/mock-agent";
import { getServerId } from "../support/helpers/server-id";
import { closeMobileAgentSidebar, openMobileAgentSidebar } from "../support/helpers/sidebar";

interface FinishedWorkspaces {
  subject: MockAgentWorkspace;
  other: MockAgentWorkspace;
}

const test = base.extend<{ workspaces: FinishedWorkspaces }>({
  workspaces: async ({ browserName: _browserName }, provide) => {
    const seeded: MockAgentWorkspace[] = [];
    async function finishedWorkspace(title: string) {
      const workspace = await seedMockAgentWorkspace({
        repoPrefix: "workspace-mark-unread-",
        title,
        initialPrompt: "Finish this turn.",
      });
      seeded.push(workspace);
      await workspace.client.waitForFinish(workspace.agentId, 20_000);
      await workspace.client.clearWorkspaceAttention(workspace.workspaceId);
      return workspace;
    }
    try {
      await provide({
        subject: await finishedWorkspace("Unread subject"),
        other: await finishedWorkspace("Other workspace"),
      });
    } finally {
      for (const workspace of seeded) await workspace.cleanup();
    }
  },
});

/** These flows predate explicit reads: opening, leaving or focusing a chat reads it. */
async function useReadOnOpen(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("@paseo:app-settings", JSON.stringify({ markReadOnOpen: true }));
  });
}

function workspaceRow(page: Page, workspaceId: string) {
  return page.getByTestId(`sidebar-workspace-row-${getServerId()}:${workspaceId}`);
}

async function openWorkspace(page: Page, workspaceId: string) {
  await workspaceRow(page, workspaceId).click();
  await expect(page).toHaveURL(new RegExp(`/workspace/${workspaceId}`));
}

async function chooseReadAction(page: Page, workspaceId: string, action: "read" | "unread") {
  await workspaceRow(page, workspaceId).hover();
  await page.getByTestId(`sidebar-workspace-kebab-${getServerId()}:${workspaceId}`).click();
  const item = page.getByRole("menuitem", { name: `Mark as ${action}`, exact: true });
  await expect(item).toBeVisible();
  await item.click();
}

async function markAsUnread(page: Page, workspaceId: string) {
  await chooseReadAction(page, workspaceId, "unread");
  await expectStatus(page, workspaceId, "attention");
}

async function markAsRead(page: Page, workspaceId: string) {
  await chooseReadAction(page, workspaceId, "read");
  await expectStatus(page, workspaceId, "done");
}

async function expectStatus(
  page: Page,
  workspaceId: string,
  status: "done" | "attention" | "needs_input",
) {
  await expect(
    workspaceRow(page, workspaceId).getByTestId(`workspace-status-indicator-${status}`),
  ).toBeVisible();
}

async function markBackgroundWorkspaceAndReopen(page: Page, workspaceId: string) {
  await test.step("background workspace gains green dot and clears when clicked", async () => {
    await markAsUnread(page, workspaceId);
    await openWorkspace(page, workspaceId);
    await expectStatus(page, workspaceId, "done");
  });
}

async function leaveMarkedWorkspaceAndRead(page: Page, { subject, other }: FinishedWorkspaces) {
  await test.step("leaving preserves manual unread until Mark as read", async () => {
    await markAsUnread(page, subject.workspaceId);
    await openWorkspace(page, other.workspaceId);
    await markAsRead(page, subject.workspaceId);
    await openWorkspace(page, subject.workspaceId);
  });
}

async function leaveMarkedWorkspaceAndReopen(page: Page, { subject, other }: FinishedWorkspaces) {
  await test.step("leaving preserves manual unread until reopening", async () => {
    await markAsUnread(page, subject.workspaceId);
    await openWorkspace(page, other.workspaceId);
    await expectStatus(page, subject.workspaceId, "attention");
    await openWorkspace(page, subject.workspaceId);
    await expectStatus(page, subject.workspaceId, "done");
  });
}

async function completeTurnAndLeave(page: Page, { subject, other }: FinishedWorkspaces) {
  await test.step("ordinary completion still clears on departure", async () => {
    await subject.client.sendAgentMessage(subject.agentId, "Finish another turn.");
    await subject.client.waitForFinish(subject.agentId, 20_000);
    await expectStatus(page, subject.workspaceId, "attention");
    await openWorkspace(page, other.workspaceId);
    await expectStatus(page, subject.workspaceId, "done");
  });
}

async function openWorkspaceOnCompact(page: Page, workspaceId: string) {
  await openWorkspace(page, workspaceId);
  await openMobileAgentSidebar(page);
}

async function leaveMarkedWorkspaceAndReadOnCompact(
  page: Page,
  { subject, other }: FinishedWorkspaces,
) {
  await test.step("leaving preserves manual unread until Mark as read", async () => {
    await markAsUnread(page, subject.workspaceId);
    await openWorkspaceOnCompact(page, other.workspaceId);
    await markAsRead(page, subject.workspaceId);
    await openWorkspaceOnCompact(page, subject.workspaceId);
  });
}

async function leaveMarkedWorkspaceAndReopenOnCompact(
  page: Page,
  { subject, other }: FinishedWorkspaces,
) {
  await test.step("leaving preserves manual unread until reopening", async () => {
    await markAsUnread(page, subject.workspaceId);
    await openWorkspaceOnCompact(page, other.workspaceId);
    await expectStatus(page, subject.workspaceId, "attention");
    await openWorkspaceOnCompact(page, subject.workspaceId);
    await expectStatus(page, subject.workspaceId, "done");
  });
}

async function completeTurnAndLeaveOnCompact(page: Page, { subject, other }: FinishedWorkspaces) {
  await test.step("ordinary completion still clears on departure", async () => {
    await closeMobileAgentSidebar(page);
    await subject.client.sendAgentMessage(subject.agentId, "Finish another turn.");
    await subject.client.waitForFinish(subject.agentId, 20_000);
    await openMobileAgentSidebar(page);
    await expectStatus(page, subject.workspaceId, "attention");
    await openWorkspaceOnCompact(page, other.workspaceId);
    await expectStatus(page, subject.workspaceId, "done");
  });
}

async function markBackgroundWorkspaceAndRead(page: Page, workspaceId: string) {
  await test.step("explicit Mark as read clears a background workspace", async () => {
    await markAsUnread(page, workspaceId);
    await markAsRead(page, workspaceId);
  });
}

async function expectSelectedAgent(page: Page, agentId: string) {
  await expect(page.getByTestId(`workspace-tab-agent_${agentId}`).first()).toHaveAttribute(
    "aria-selected",
    "true",
  );
}

async function addFinishedAgent(workspace: MockAgentWorkspace) {
  return workspace.client.createAgent({
    provider: "mock",
    cwd: workspace.cwd,
    workspaceId: workspace.workspaceId,
    title: "Newest agent",
    modeId: "load-test",
    model: "e2e-fast-stream",
  });
}

async function openCompactWorkspace(page: Page, workspace: MockAgentWorkspace) {
  await page.setViewportSize({ width: 390, height: 844 });
  await openAgentRoute(page, workspace);
  await openMobileAgentSidebar(page);
}

async function markUnreadThenResumeChat(page: Page, workspaceId: string) {
  await test.step("interacting with the visible chat clears manual unread", async () => {
    await markAsUnread(page, workspaceId);
    await closeMobileAgentSidebar(page);
    await page.getByRole("textbox", { name: "Message agent..." }).click();
    await openMobileAgentSidebar(page);
    await expectStatus(page, workspaceId, "done");
  });
}

test("manual unread survives departure and clears on reopening without changing normal completions", async ({
  page,
  workspaces,
}) => {
  await useReadOnOpen(page);
  await gotoAppShell(page);
  await openWorkspace(page, workspaces.other.workspaceId);
  await markBackgroundWorkspaceAndReopen(page, workspaces.subject.workspaceId);
  await leaveMarkedWorkspaceAndRead(page, workspaces);
  await leaveMarkedWorkspaceAndReopen(page, workspaces);
  await completeTurnAndLeave(page, workspaces);
  await markBackgroundWorkspaceAndRead(page, workspaces.subject.workspaceId);
});

test("clicking a multi-agent workspace reveals and clears its marked agent", async ({
  page,
  workspaces,
}) => {
  await useReadOnOpen(page);
  await openAgentRoute(page, workspaces.subject);
  await expectSelectedAgent(page, workspaces.subject.agentId);
  await openWorkspace(page, workspaces.other.workspaceId);
  const newest = await addFinishedAgent(workspaces.subject);
  await markBackgroundWorkspaceAndReopen(page, workspaces.subject.workspaceId);
  await expectSelectedAgent(page, newest.id);
});

test("manual unread survives leaving the current workspace on compact layout", async ({
  page,
  workspaces,
}) => {
  await useReadOnOpen(page);
  await openCompactWorkspace(page, workspaces.subject);
  await leaveMarkedWorkspaceAndReadOnCompact(page, workspaces);
  await leaveMarkedWorkspaceAndReopenOnCompact(page, workspaces);
  await markUnreadThenResumeChat(page, workspaces.subject.workspaceId);
  await completeTurnAndLeaveOnCompact(page, workspaces);
});

test("by default a chat stays unread until its sidebar or tab check marks it read", async ({
  page,
  workspaces,
}) => {
  const { subject, other } = workspaces;
  await gotoAppShell(page);
  await openWorkspace(page, other.workspaceId);

  await test.step("opening, focusing the composer and leaving keep it unread", async () => {
    await markAsUnread(page, subject.workspaceId);
    await openWorkspace(page, subject.workspaceId);
    await expectSelectedAgent(page, subject.agentId);
    await page.getByRole("textbox", { name: "Message agent..." }).click();
    await expectStatus(page, subject.workspaceId, "attention");
    await openWorkspace(page, other.workspaceId);
    await expectStatus(page, subject.workspaceId, "attention");
  });

  await test.step("the sidebar row check marks it read", async () => {
    await workspaceRow(page, subject.workspaceId).hover();
    const check = page.getByTestId(
      `sidebar-workspace-mark-as-read-${getServerId()}:${subject.workspaceId}`,
    );
    // Like the row's kebab, the check is a labelled control inside the row's own button on web.
    await expect(check).toHaveAttribute("aria-label", "Mark main as read");
    await page.screenshot({ path: "test-results/explicit-read-sidebar-check.png" });
    await check.click();
    await expectStatus(page, subject.workspaceId, "done");
    await expect(check).toHaveCount(0);
    // The check reads the row in place; it does not open the workspace.
    await expect(page).toHaveURL(new RegExp(`/workspace/${other.workspaceId}`));
  });

  await test.step("the open tab shows a check that marks it read", async () => {
    await markAsUnread(page, subject.workspaceId);
    await openWorkspace(page, subject.workspaceId);
    const tabCheck = page.getByTestId(`workspace-tab-mark-as-read-agent_${subject.agentId}`);
    await expect(tabCheck).toBeVisible();
    await expect(tabCheck).toHaveAccessibleName(/^Mark .*Unread subject.* as read$/);
    await page.screenshot({ path: "test-results/explicit-read-tab-check.png" });
    await tabCheck.click();
    await expectStatus(page, subject.workspaceId, "done");
    await expect(tabCheck).toHaveCount(0);
  });
});

function agentTab(page: Page, agentId: string) {
  return page.getByTestId(`workspace-tab-agent_${agentId}`).first();
}

function tabReadCheck(page: Page, agentId: string) {
  return page.getByTestId(`workspace-tab-mark-as-read-agent_${agentId}`);
}

async function finishRealTurn(workspace: MockAgentWorkspace, prompt: string) {
  await workspace.client.sendAgentMessage(workspace.agentId, prompt);
  await workspace.client.waitForFinish(workspace.agentId, 20_000);
}

/** The open tab's check must sit clear of its title, not over it. */
async function expectCheckClearOfTitle(page: Page, agentId: string, title: string) {
  const titleBox = await agentTab(page, agentId).getByText(title, { exact: true }).boundingBox();
  const checkBox = await tabReadCheck(page, agentId).boundingBox();
  expect(titleBox).not.toBeNull();
  expect(checkBox).not.toBeNull();
  expect(titleBox!.x + titleBox!.width).toBeLessThanOrEqual(checkBox!.x);
}

test("a real finished turn stays unread across leaving and a reload until its tab check reads it", async ({
  page,
  workspaces,
}) => {
  const { subject, other } = workspaces;
  await gotoAppShell(page);
  await openWorkspace(page, other.workspaceId);

  await test.step("the turn finishes while another workspace is open", async () => {
    await finishRealTurn(subject, "Finish a turn in the background.");
    await expectStatus(page, subject.workspaceId, "attention");
  });

  await test.step("a cold reload still shows the tab as unread", async () => {
    await page.reload();
    await openWorkspace(page, subject.workspaceId);
    await expectSelectedAgent(page, subject.agentId);
    await expect(
      agentTab(page, subject.agentId).getByTestId(/^workspace-tab-unread-/),
    ).toBeVisible();
    await expectStatus(page, subject.workspaceId, "attention");
    await expectCheckClearOfTitle(page, subject.agentId, "Unread subject");
    await page.screenshot({ path: "test-results/explicit-read-tab-check-1x.png" });
  });

  await test.step("the tab check reads it, and newer activity makes it unread again", async () => {
    await tabReadCheck(page, subject.agentId).click();
    await expectStatus(page, subject.workspaceId, "done");
    await expect(agentTab(page, subject.agentId).getByTestId(/^workspace-tab-unread-/)).toHaveCount(
      0,
    );
    await finishRealTurn(subject, "Finish one more turn while open.");
    await expectStatus(page, subject.workspaceId, "attention");
    await expect(
      agentTab(page, subject.agentId).getByTestId(/^workspace-tab-unread-/),
    ).toBeVisible();
  });
});

test("sending a prompt reads the chat with a bounded read clear", async ({ page, workspaces }) => {
  const { subject, other } = workspaces;
  const clears: Array<Record<string, unknown>> = [];
  page.on("websocket", (socket) =>
    socket.on("framesent", ({ payload }) => {
      const envelope = JSON.parse(payload.toString());
      if (envelope.type === "session" && envelope.message?.type === "clear_agent_attention") {
        clears.push(envelope.message);
      }
    }),
  );
  await gotoAppShell(page);
  await openWorkspace(page, other.workspaceId);
  await finishRealTurn(subject, "Finish before the reply.");
  await openWorkspace(page, subject.workspaceId);
  await expectStatus(page, subject.workspaceId, "attention");
  // Opening alone sent no read.
  expect(clears).toEqual([]);

  const composer = page.getByRole("textbox", { name: "Message agent..." }).first();
  await composer.fill("Replying reads this chat.");
  await composer.press("Enter");
  await expect
    .poll(() => clears.find((message) => message.agentId === subject.agentId))
    .toMatchObject({ read: { seenAttentionAt: expect.any(String) } });
});

test("the sidebar check is reachable and usable from the keyboard", async ({
  page,
  workspaces,
}) => {
  const { subject, other } = workspaces;
  await gotoAppShell(page);
  await openWorkspace(page, other.workspaceId);
  // Marked through the host, not the row's menu: a used kebab menu leaves the row revealed (a
  // pre-existing hover quirk), and this test needs a row that is neither hovered nor focused.
  await subject.client.markWorkspaceUnread(subject.workspaceId);
  await expectStatus(page, subject.workspaceId, "attention");
  await page.getByRole("textbox", { name: "Message agent..." }).first().click();
  await page.mouse.move(0, 0);

  const check = page.getByTestId(
    `sidebar-workspace-mark-as-read-${getServerId()}:${subject.workspaceId}`,
  );
  await expect(check).toHaveCount(0);
  // A keypress first, so the row's focus counts as keyboard focus (:focus-visible).
  await page.keyboard.press("Shift");
  await workspaceRow(page, subject.workspaceId).focus();
  await expect(check).toBeVisible();
  for (let presses = 0; presses < 4; presses += 1) {
    if (await check.evaluate((node) => node === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(check).toBeFocused();
  await expect(check).toHaveAttribute("aria-label", "Mark main as read");
  await page.keyboard.press("Enter");
  await expectStatus(page, subject.workspaceId, "done");
});

test("on a touch layout the sidebar check shows without hover and is touch sized", async ({
  page,
  workspaces,
}) => {
  const { subject, other } = workspaces;
  await openCompactWorkspace(page, other);
  await markAsUnread(page, subject.workspaceId);
  const check = page.getByTestId(
    `sidebar-workspace-mark-as-read-${getServerId()}:${subject.workspaceId}`,
  );
  await page.mouse.move(0, 0);
  await expect(check).toBeVisible();
  const box = await check.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(32);
  expect(box!.height).toBeGreaterThanOrEqual(32);
  // The row keeps its kebab beside the check.
  const kebab = page.getByTestId(`sidebar-workspace-kebab-${getServerId()}:${subject.workspaceId}`);
  await expect(kebab).toBeVisible();
  const kebabBox = await kebab.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(kebabBox!.x + 1);
  await expect(page.getByText("Workspace actions", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: "test-results/explicit-read-sidebar-check-compact.png" });
  await check.click();
  await expectStatus(page, subject.workspaceId, "done");
});

test.describe("at 2x", () => {
  test.use({ deviceScaleFactor: 2 });

  test("the open tab's check stays clear of its title", async ({ page, workspaces }) => {
    const { subject, other } = workspaces;
    await gotoAppShell(page);
    await openWorkspace(page, other.workspaceId);
    await markAsUnread(page, subject.workspaceId);
    await openWorkspace(page, subject.workspaceId);
    await expect(tabReadCheck(page, subject.agentId)).toBeVisible();
    await expectCheckClearOfTitle(page, subject.agentId, "Unread subject");
    await page.screenshot({ path: "test-results/explicit-read-tab-check-2x.png" });
  });
});

test("the read-on-open setting restores focus-driven reads", async ({ page, workspaces }) => {
  const { subject, other } = workspaces;
  await gotoAppShell(page);
  await page.goto("/settings/chat");
  const setting = page.getByRole("switch", { name: "Mark chats read when opened" });
  await expect(setting).not.toBeChecked();
  await setting.click();
  await expect(setting).toBeChecked();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("@paseo:app-settings")))
    .toContain('"markReadOnOpen":true');
  await gotoAppShell(page);
  await openWorkspace(page, other.workspaceId);
  await markAsUnread(page, subject.workspaceId);
  await openWorkspace(page, subject.workspaceId);
  await expectStatus(page, subject.workspaceId, "done");
});

async function setWorkspaceManualStatus(page: Page, workspaceId: string, status: string) {
  await workspaceRow(page, workspaceId).click({ button: "right" });
  await page.getByTestId("manual-status-menu").click();
  await page.getByTestId(`manual-status-${status}`).click();
  await expect(page.getByText("Status updated", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
}

test("workspace manual Needs input needs no chooser, survives reading/reload and clears explicitly", async ({
  page,
  workspaces,
}) => {
  await openAgentRoute(page, workspaces.subject);
  const sibling = await addFinishedAgent(workspaces.subject);
  await setWorkspaceManualStatus(page, workspaces.subject.workspaceId, "needs_input");
  await expectStatus(page, workspaces.subject.workspaceId, "needs_input");
  for (const id of [workspaces.subject.agentId, sibling.id]) {
    const result = await workspaces.subject.client.fetchAgent({ agentId: id });
    expect(result?.agent.labels["paseo.manual-needs-input"]).toBe("true");
    expect(result?.agent.pendingPermissions).toEqual([]);
  }
  expect(
    (await workspaces.other.client.fetchAgent({ agentId: workspaces.other.agentId }))?.agent.labels[
      "paseo.manual-needs-input"
    ],
  ).toBeUndefined();
  await openWorkspace(page, workspaces.other.workspaceId);
  await openWorkspace(page, workspaces.subject.workspaceId);
  await page.reload();
  await expectStatus(page, workspaces.subject.workspaceId, "needs_input");
  await setWorkspaceManualStatus(page, workspaces.subject.workspaceId, "clear");
  await expectStatus(page, workspaces.subject.workspaceId, "done");
});

test("tab review status changes only that session and remains after reading", async ({
  page,
  workspaces,
}) => {
  await openAgentRoute(page, workspaces.subject);
  const sibling = await addFinishedAgent(workspaces.subject);
  const tab = page.getByTestId(`workspace-tab-agent_${workspaces.subject.agentId}`).first();
  await tab.click({ button: "right" });
  await page.getByTestId("manual-status-menu").click();
  await page.getByTestId("manual-status-ready").click();
  await expect(page.getByText("Status updated", { exact: true })).toBeVisible();
  await expect(page.getByTestId("manual-status-ready")).toHaveAttribute("aria-checked", "true");
  await page.screenshot({ path: "test-results/manual-status-desktop.png" });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expectStatus(page, workspaces.subject.workspaceId, "attention");
  expect(
    (await workspaces.subject.client.fetchAgent({ agentId: sibling.id }))?.agent.labels[
      "paseo.review-status"
    ],
  ).toBeUndefined();
  await openWorkspace(page, workspaces.other.workspaceId);
  await openWorkspace(page, workspaces.subject.workspaceId);
  await expectStatus(page, workspaces.subject.workspaceId, "attention");
  expect(
    (await workspaces.subject.client.fetchAgent({ agentId: workspaces.subject.agentId }))?.agent
      .labels["paseo.review-status"],
  ).toBe("ready");
  await chooseReadAction(page, workspaces.subject.workspaceId, "unread");
  await chooseReadAction(page, workspaces.subject.workspaceId, "read");
  await expectStatus(page, workspaces.subject.workspaceId, "attention");
});

test("compact workspace status menu exposes manual input", async ({ page, workspaces }) => {
  await openCompactWorkspace(page, workspaces.subject);
  await page
    .getByTestId(`sidebar-workspace-kebab-${getServerId()}:${workspaces.subject.workspaceId}`)
    .click();
  await page.getByTestId("manual-status-menu").click();
  const clearRow = page.getByTestId("manual-status-clear");
  await expect(clearRow).toBeInViewport();
  const mountedRow = await clearRow.elementHandle();
  await page.getByTestId("manual-status-needs_input").click();
  await expect(page.getByText("Status updated", { exact: true })).toBeVisible();
  await expect(page.getByTestId("manual-status-needs_input")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  expect(await mountedRow?.evaluate((node) => node.isConnected)).toBe(true);
  await expect(clearRow).toBeInViewport();
  await page.screenshot({ path: "test-results/manual-status-compact.png" });
  expect(
    (await workspaces.subject.client.fetchAgent({ agentId: workspaces.subject.agentId }))?.agent
      .labels["paseo.manual-needs-input"],
  ).toBe("true");
});

test("older hosts keep unread controls and explain unavailable manual statuses", async ({
  page,
  workspaces,
}) => {
  await overrideServerInfoFeatures(page, { manualAgentStatus: false });
  await openAgentRoute(page, workspaces.subject);
  await workspaceRow(page, workspaces.subject.workspaceId).click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Mark as unread", exact: true })).toBeVisible();
  await page.getByTestId("manual-status-menu").click();
  await expect(
    page.getByText("Update this host to use manual statuses.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("manual-status-needs_input")).toHaveCount(0);
});
