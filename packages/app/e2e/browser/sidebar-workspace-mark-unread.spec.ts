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
  await openCompactWorkspace(page, workspaces.subject);
  await leaveMarkedWorkspaceAndReadOnCompact(page, workspaces);
  await leaveMarkedWorkspaceAndReopenOnCompact(page, workspaces);
  await markUnreadThenResumeChat(page, workspaces.subject.workspaceId);
  await completeTurnAndLeaveOnCompact(page, workspaces);
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
