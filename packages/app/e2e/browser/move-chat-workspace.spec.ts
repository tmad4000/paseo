import { expect, test } from "../support/fixtures";
import { createMockIdleAgent, expectWorkspaceTabHidden } from "../support/helpers/archive-tab";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { waitForWorkspaceTabsVisible } from "../support/helpers/workspace-tabs";
import { buildHostAgentDetailRoute } from "@/utils/host-routes";

test("moves an aside through the tab menu, preserves the chat and reuses Asides", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const workspace = await seedWorkspace({ repoPrefix: "move-chat-" });
  try {
    const agent = await createMockIdleAgent(workspace.client, {
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "An unrelated aside",
    });
    const prompt = "Keep this aside: emit 1 coalesced agent stream updates";
    await workspace.client.sendAgentMessage(agent.id, prompt);
    await workspace.client.waitForFinish(agent.id, 30_000);
    const before = await workspace.client.fetchAgentTimeline(agent.id);
    expect(
      before.entries.some(({ item }) => item.type === "user_message" && item.text === prompt),
    ).toBe(true);
    await page.goto(buildHostAgentDetailRoute(getServerId(), agent.id, agent.workspaceId));
    await page.waitForURL(
      (url) => url.pathname.includes("/workspace/") && !url.searchParams.has("open"),
    );
    await waitForWorkspaceTabsVisible(page);
    await page.getByRole("button", { name: agent.title, exact: true }).click({ button: "right" });
    await page.getByTestId(`workspace-tab-context-agent_${agent.id}-move-workspace`).click();
    await expect(page.getByTestId("move-chat-dialog")).toBeVisible();
    await expect(
      page.getByText("History and the original working directory stay with this chat."),
    ).toBeVisible();
    await page.screenshot({ path: "test-results/move-chat-desktop.png" });
    await page.getByTestId("move-chat-submit").click();
    await expect(page.getByTestId("move-chat-dialog")).toBeHidden();
    await expectWorkspaceTabHidden(page, agent.id);
    const moved = await workspace.client.fetchAgent({ agentId: agent.id });
    expect(moved?.agent.id).toBe(agent.id);
    const after = await workspace.client.fetchAgentTimeline(agent.id);
    expect(after.entries).toEqual(before.entries);
    expect(moved?.agent.cwd).toBe(workspace.repoPath);
    expect(moved?.agent.archivedAt).toBeNull();
    const destinationId = moved?.agent.workspaceId;
    expect(destinationId).toBeTruthy();
    expect(destinationId).not.toBe(workspace.workspaceId);
    if (!destinationId) throw new Error("Move did not return a workspace");
    const second = await createMockIdleAgent(workspace.client, {
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Another aside",
    });
    const reused = await workspace.client.moveAgentToWorkspace({
      agentId: second.id,
      expectedWorkspaceId: workspace.workspaceId,
      destination: { kind: "asides" },
    });
    expect(reused.workspace?.id).toBe(destinationId);
    await page.goto(buildHostAgentDetailRoute(getServerId(), agent.id, destinationId));
    await waitForWorkspaceTabsVisible(page);
    await expect(page.getByRole("button", { name: agent.title, exact: true })).toBeVisible();
    await page.reload();
    await waitForWorkspaceTabsVisible(page);
    await expect(page.getByRole("button", { name: agent.title, exact: true })).toBeVisible();
    await expect(page).toHaveTitle(/Asides|unrelated aside/i);
    await page.screenshot({ path: "test-results/move-chat-destination.png" });
    const third = await createMockIdleAgent(workspace.client, {
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Own workspace",
    });
    const newWorkspaceId = "wks_5a5a5a5a5a5a5a5a";
    const individual = await workspace.client.moveAgentToWorkspace({
      agentId: third.id,
      expectedWorkspaceId: workspace.workspaceId,
      destination: { kind: "new", workspaceId: newWorkspaceId, title: "Separate topic" },
    });
    expect(individual.workspace?.name).toBe("Separate topic");
    expect(individual.agent?.cwd).toBe(workspace.repoPath);
    const retry = await workspace.client.moveAgentToWorkspace({
      agentId: third.id,
      expectedWorkspaceId: workspace.workspaceId,
      destination: { kind: "new", workspaceId: newWorkspaceId, title: "Separate topic" },
    });
    expect(retry.workspace?.id).toBe(newWorkspaceId);
  } finally {
    await workspace.cleanup();
  }
});

test("creates an individual workspace through the compact tab menu", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const workspace = await seedWorkspace({ repoPrefix: "move-chat-compact-" });
  try {
    const agent = await createMockIdleAgent(workspace.client, {
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "A compact aside",
    });
    await page.goto(buildHostAgentDetailRoute(getServerId(), agent.id, agent.workspaceId));
    await expect(page.getByTestId("workspace-tab-switcher-trigger")).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: /Switch tabs/ }).click();
    const menuBase = `workspace-tab-menu-agent_${agent.id}`;
    await page.getByTestId(`${menuBase}-trigger`).click();
    await page.getByTestId(`${menuBase}-move-workspace`).click();
    await expect(page.getByTestId("move-chat-dialog")).toBeVisible();
    await page.getByTestId("move-chat-destination").click();
    await page.getByText("New workspace…", { exact: true }).click();
    await expect(page.getByText("Shared catch-all on this host", { exact: true })).toBeHidden();
    await page.getByTestId("move-chat-name").fill("An independent topic");
    await page.screenshot({ path: "test-results/move-chat-compact.png" });
    await page.getByTestId("move-chat-submit").click();
    await expect(page.getByTestId("move-chat-dialog")).toBeHidden();
    const moved = await workspace.client.fetchAgent({ agentId: agent.id });
    expect(moved?.agent.workspaceId).not.toBe(workspace.workspaceId);
    expect(moved?.agent.cwd).toBe(workspace.repoPath);
    const entries = await workspace.client.fetchWorkspaces();
    expect(entries.entries.find((item) => item.id === moved?.agent.workspaceId)?.name).toBe(
      "An independent topic",
    );
  } finally {
    await workspace.cleanup();
  }
});
