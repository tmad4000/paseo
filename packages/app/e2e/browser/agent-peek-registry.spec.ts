import type { Page } from "@playwright/test";
import { PARENT_AGENT_ID_LABEL } from "@getpaseo/protocol/agent-labels";
import { expect, test } from "../support/fixtures";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";

const PARENT_COMPOSER = "Message agent...";

interface Seeded {
  parentId: string;
  builderId: string;
  reviewerId: string;
  workspaceId: string;
  providerIds: string[];
}

/**
 * Provider subagents come from a provider's own runtime, which the mock provider does not have.
 * The daemon's list response for the orchestrator is rewritten to carry three, as a Claude
 * fan-out of Explore tasks would.
 */
async function injectProviderSubagents(page: Page, parentAgentId: string, ids: string[]) {
  const base = Date.parse("2026-11-14T08:00:00.000Z");
  const subagents = ids.map((id, index) => ({
    id,
    parentAgentId,
    parentSubagentId: null,
    provider: "claude",
    title: "Explore",
    description: `Map area ${index + 1}`,
    status: index === 0 ? "running" : "completed",
    // Older than both spawned agents, so creation order alone would interleave them.
    createdAt: new Date(base + index * 1000).toISOString(),
    updatedAt: new Date(base + index * 1000 + 500).toISOString(),
    toolCallId: null,
    subtitle: "Explore · 1.2k tokens",
  }));
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      if (typeof message === "string" && message.includes("agent.provider_subagents.list")) {
        const envelope = JSON.parse(message) as {
          type?: string;
          message?: { type?: string; payload?: Record<string, unknown> };
        };
        const payload = envelope.message?.payload;
        if (
          envelope.type === "session" &&
          envelope.message?.type === "agent.provider_subagents.list.response" &&
          payload?.parentAgentId === parentAgentId
        ) {
          payload.subagents = subagents;
          payload.error = null;
          ws.send(JSON.stringify(envelope));
          return;
        }
      }
      ws.send(message);
    });
  });
}

async function seedOrchestrator(workspace: SeededWorkspace, prefix: string): Promise<Seeded> {
  const { client } = workspace;
  const parent = await client.createAgent({
    provider: "mock",
    cwd: workspace.repoPath,
    workspaceId: workspace.workspaceId,
    title: `${prefix} orchestrator`,
    modeId: "load-test",
    model: "e2e-fast-stream",
  });
  const builder = await client.createAgent({
    provider: "mock",
    cwd: workspace.repoPath,
    workspaceId: workspace.workspaceId,
    title: `${prefix} builder`,
    modeId: "load-test",
    model: "one-minute-stream",
    initialPrompt: "Build the registry.",
    labels: { [PARENT_AGENT_ID_LABEL]: parent.id },
  });
  const reviewer = await client.createAgent({
    provider: "mock",
    cwd: workspace.repoPath,
    workspaceId: workspace.workspaceId,
    title: `${prefix} reviewer`,
    modeId: "load-test",
    model: "e2e-fast-stream",
    labels: { [PARENT_AGENT_ID_LABEL]: parent.id },
  });
  await client.waitForAgentUpsert(builder.id, (s) => s.status === "running", 30_000);
  await client.waitForAgentUpsert(reviewer.id, (s) => s.status === "idle", 30_000);
  await client.waitForAgentUpsert(parent.id, (s) => s.status === "idle", 30_000);
  return {
    parentId: parent.id,
    builderId: builder.id,
    reviewerId: reviewer.id,
    workspaceId: workspace.workspaceId,
    providerIds: [`${prefix}-task-1`, `${prefix}-task-2`, `${prefix}-task-3`],
  };
}

async function lastUserMessageAt(workspace: SeededWorkspace, agentId: string) {
  const result = await workspace.client.fetchAgent({ agentId });
  const agent = result?.agent as { lastUserMessageAt?: string | null } | undefined;
  return agent?.lastUserMessageAt ?? null;
}

/** Test ids in DOM order inside `scope`, filtered to one prefix. */
async function testIdsInOrder(page: Page, scope: string, prefix: string): Promise<string[]> {
  return page
    .getByTestId(scope)
    .first()
    .evaluate(
      (root, wanted) =>
        [...root.querySelectorAll("[data-testid]")]
          .map((node) => node.getAttribute("data-testid") ?? "")
          .filter((id) => id.startsWith(wanted)),
      prefix,
    );
}

async function screenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: test.info().outputPath(`${name}.png`) });
}

test.describe("Agent peek and the spawned-agent registry", () => {
  let workspace: SeededWorkspace;

  test.beforeAll(async () => {
    workspace = await seedWorkspace({ repoPrefix: "agent-peek-registry-" });
  });

  test.afterAll(async () => {
    await workspace?.cleanup();
  });

  test("groups spawned agents apart from provider subagents, with cards that expand and peek", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const seeded = await seedOrchestrator(workspace, "desk");
    await injectProviderSubagents(page, seeded.parentId, seeded.providerIds);
    // The builder works an ask, so its pulse chip is a second way into the same peek.
    await workspace.client.updateStreamEntry({
      agentId: seeded.parentId,
      action: "set_ask",
      entryId: "registry",
      text: "Build the registry",
      expectedRevision: 0,
      ask: {
        state: "in_progress",
        remaining: "Waiting on the builder.",
        evidence: "",
        delegatedAgentId: seeded.builderId,
      },
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await openAgentRoute(page, { workspaceId: seeded.workspaceId, agentId: seeded.parentId });
    const parentComposer = page.getByRole("textbox", { name: PARENT_COMPOSER });
    await expect(parentComposer).toBeEditable({ timeout: 60_000 });

    // Track panel: two headings, spawned agents first, provider subagents after, each in order.
    await page.getByTestId("subagents-track-header").click();
    const trackPanel = page.getByTestId("subagents-track-header-panel");
    await expect(trackPanel.getByTestId("subagents-track-heading-paseo")).toHaveText(
      "Spawned agents · 2",
    );
    await expect(trackPanel.getByTestId("subagents-track-heading-provider")).toHaveText(
      "Provider subagents · 3",
    );
    expect(
      await testIdsInOrder(page, "subagents-track-header-panel", "subagents-track-row-"),
    ).toEqual([
      `subagents-track-row-${seeded.builderId}`,
      `subagents-track-row-${seeded.reviewerId}`,
      ...seeded.providerIds.map((id) => `subagents-track-row-${id}`),
    ]);
    await screenshot(page, "track-panel-1440");
    await page.keyboard.press("Escape");
    await expect(trackPanel).toBeHidden();

    // A draft in the parent survives everything below.
    await parentComposer.fill("parent draft stays");

    // The registry: spawned agents open, provider subagents folded with their summary.
    await page.getByTestId("subthreads-open").click();
    const drawer = page.getByTestId("subthreads-drawer");
    await expect(drawer).toBeVisible({ timeout: 30_000 });
    const spawnedToggle = drawer.getByTestId("subthreads-group-toggle-paseo");
    const providerToggle = drawer.getByTestId("subthreads-group-toggle-provider");
    await expect(spawnedToggle).toHaveAttribute("aria-expanded", "true");
    await expect(spawnedToggle).toHaveAccessibleName(/^Spawned agents, 2(, 1 working)?$/);
    await expect(providerToggle).toHaveAttribute("aria-expanded", "false");
    await expect(drawer.getByTestId("subthreads-group-summary-provider")).toHaveText("1 working");
    await expect(drawer.getByTestId(`subthreads-row-${seeded.providerIds[0]}`)).toHaveCount(0);
    // The header line counts spawned agents only.
    await expect(drawer.getByTestId("subthreads-summary")).not.toContainText("3");

    // A card: state, model, a ticking age; it expands in place without opening a tab.
    const builderCard = drawer.getByTestId(`subthreads-card-${seeded.builderId}`);
    await expect(builderCard).toContainText("desk builder");
    await expect(builderCard).toContainText("Working");
    await expect(drawer.getByTestId(`subthreads-card-model-${seeded.builderId}`)).not.toBeEmpty();
    await expect(drawer.getByTestId(`subthreads-card-age-${seeded.builderId}`)).toHaveText(
      /^(now|\d+[smhd])$/,
    );
    const builderToggle = drawer.getByTestId(`subthreads-card-toggle-${seeded.builderId}`);
    await builderToggle.click();
    await expect(builderToggle).toHaveAttribute("aria-expanded", "true");
    const detail = drawer.getByTestId(`subthreads-card-detail-${seeded.builderId}`);
    await expect(detail.getByTestId(`subthreads-card-peek-${seeded.builderId}`)).toBeVisible();
    await expect(
      detail.getByTestId(`subthreads-card-open-in-tab-${seeded.builderId}`),
    ).toBeVisible();
    await expect(detail.getByTestId(`subthreads-card-more-${seeded.builderId}`)).toBeVisible();
    await expect(page.getByTestId(`workspace-tab-agent_${seeded.builderId}`)).toHaveCount(0);

    // Unfold provider subagents: creation order, after the spawned group, never interleaved.
    await providerToggle.click();
    await expect(providerToggle).toHaveAttribute("aria-expanded", "true");
    expect(await testIdsInOrder(page, "subthreads-registry", "subthreads-row-")).toEqual([
      `subthreads-row-${seeded.builderId}`,
      `subthreads-row-${seeded.reviewerId}`,
      ...seeded.providerIds.map((id) => `subthreads-row-${id}`),
    ]);
    await screenshot(page, "registry-1440");

    // Keyboard: Up and Down cross groups, Left folds a card, Right expands it.
    await drawer.getByTestId(`subthreads-row-${seeded.builderId}`).focus();
    await page.keyboard.press("ArrowDown");
    await expect(drawer.getByTestId(`subthreads-row-${seeded.reviewerId}`)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(providerToggle).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowRight");
    await expect(drawer.getByTestId(`subthreads-card-toggle-${seeded.reviewerId}`)).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await page.keyboard.press("ArrowLeft");
    await expect(drawer.getByTestId(`subthreads-card-toggle-${seeded.reviewerId}`)).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    // Fold the spawned group; the folds survive a reload, card expansion does not.
    await spawnedToggle.click();
    await expect(spawnedToggle).toHaveAttribute("aria-expanded", "false");
    await expect(drawer.getByTestId("subthreads-group-summary-paseo")).toBeVisible();
    await page.reload();
    await expect(parentComposer).toBeVisible({ timeout: 60_000 });
    if (!(await drawer.isVisible())) await page.getByTestId("subthreads-open").click();
    await expect(drawer.getByTestId("subthreads-group-toggle-paseo")).toHaveAttribute(
      "aria-expanded",
      "false",
      { timeout: 30_000 },
    );
    await expect(drawer.getByTestId("subthreads-group-toggle-provider")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await drawer.getByTestId("subthreads-group-toggle-paseo").click();
    await expect(drawer.getByTestId(`subthreads-card-toggle-${seeded.builderId}`)).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await drawer.getByTestId("subthreads-close").click();
    await expect(drawer).toBeHidden();
    await parentComposer.fill("parent draft stays");

    // The Questions and asks pane: Spawned agents replaces Delegated chats, folded, and peeks.
    const pane = page.getByTestId("tracked-answers-pane");
    const section = pane.getByTestId("spawned-agents");
    const sectionToggle = section.getByTestId("spawned-agents-toggle");
    await expect(sectionToggle).toContainText("Spawned agents · 2");
    await expect(sectionToggle).toHaveAttribute("aria-expanded", "false");
    await expect(section.getByTestId(`spawned-agents-row-${seeded.reviewerId}`)).toHaveCount(0);
    await sectionToggle.click();
    await expect(section.getByTestId(`spawned-agents-row-${seeded.reviewerId}`)).toBeVisible();
    await screenshot(page, "asks-pane-1440");

    await section.getByTestId(`spawned-agents-row-${seeded.reviewerId}`).click();
    await expect(drawer.getByTestId(`subthreads-thread-${seeded.reviewerId}`)).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId(`workspace-tab-agent_${seeded.reviewerId}`)).toHaveCount(0);
    await expect(parentComposer).toHaveValue("parent draft stays");
    const reply = drawer.getByRole("textbox", { name: "Reply to desk reviewer" });
    await expect(reply).toBeEditable({ timeout: 30_000 });
    await reply.fill("Check the empty state");
    await reply.press("Enter");
    await expect
      .poll(() => lastUserMessageAt(workspace, seeded.reviewerId), { timeout: 30_000 })
      .not.toBeNull();
    expect(await lastUserMessageAt(workspace, seeded.parentId)).toBeNull();
    await expect(parentComposer).toHaveValue("parent draft stays");
    await screenshot(page, "peek-1440");

    // Escape on the peek's header returns to the list, focus on the card it came from.
    await drawer.getByTestId("subthreads-back").focus();
    await page.keyboard.press("Escape");
    await expect(drawer.getByTestId(`subthreads-row-${seeded.reviewerId}`)).toBeFocused();
    await drawer.getByTestId("subthreads-close").click();

    // The pulse chip on the delegated ask peeks too.
    await pane.getByTestId("open-ask-ask:registry").getByTestId("open-ask-owner").click();
    await expect(drawer.getByTestId(`subthreads-thread-${seeded.builderId}`)).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId(`workspace-tab-agent_${seeded.builderId}`)).toHaveCount(0);

    // The section fold is remembered across a reload.
    await page.reload();
    await expect(parentComposer).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByTestId("tracked-answers-pane").getByTestId("spawned-agents-toggle"),
    ).toHaveAttribute("aria-expanded", "true", { timeout: 30_000 });

    // Mod+Enter on a card opens its tab directly.
    if (!(await drawer.isVisible())) await page.getByTestId("subthreads-open").click();
    if (await drawer.getByTestId("subthreads-back").isVisible()) {
      await drawer.getByTestId("subthreads-back").click();
    }
    await drawer.getByTestId(`subthreads-row-${seeded.reviewerId}`).focus();
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(page.getByTestId(`workspace-tab-agent_${seeded.reviewerId}`).first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test("covers the chat on a phone with every control visible without hover", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const seeded = await seedOrchestrator(workspace, "phone");
    await injectProviderSubagents(page, seeded.parentId, seeded.providerIds);
    await openAgentRoute(page, { workspaceId: seeded.workspaceId, agentId: seeded.parentId });
    await expect(page.getByRole("textbox", { name: PARENT_COMPOSER })).toBeVisible({
      timeout: 60_000,
    });

    await page.getByTestId("subthreads-open").click();
    const drawer = page.getByTestId("subthreads-drawer");
    await expect(drawer).toBeVisible({ timeout: 30_000 });
    await expect(drawer.getByTestId("subthreads-group-toggle-paseo")).toBeVisible();
    await expect(drawer.getByTestId("subthreads-group-toggle-provider")).toBeVisible();
    // Nothing on a card appears only on hover.
    const toggle = drawer.getByTestId(`subthreads-card-toggle-${seeded.builderId}`);
    await expect(toggle).toBeVisible();
    const box = await drawer.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(380);
    await toggle.click();
    await expect(drawer.getByTestId(`subthreads-card-peek-${seeded.builderId}`)).toBeVisible();
    await screenshot(page, "registry-390");

    await drawer.getByTestId(`subthreads-card-peek-${seeded.builderId}`).click();
    await expect(drawer.getByTestId(`subthreads-thread-${seeded.builderId}`)).toBeVisible({
      timeout: 30_000,
    });
    await expect(drawer.getByRole("textbox", { name: "Reply to phone builder" })).toBeVisible({
      timeout: 30_000,
    });
    await screenshot(page, "peek-390");
    await drawer.getByTestId("subthreads-close").click();
    await expect(drawer).toBeHidden();

    const pane = page.getByTestId("tracked-answers-pane");
    // Phones start the pane minimized; open it to reach the section.
    const expand = pane.getByTestId("tracked-answers-expand");
    if (await expand.isVisible()) await expand.click();
    const sectionToggle = pane.getByTestId("spawned-agents-toggle");
    await expect(sectionToggle).toBeVisible({ timeout: 30_000 });
    await sectionToggle.click();
    await expect(pane.getByTestId(`spawned-agents-row-${seeded.reviewerId}`)).toBeVisible();
    await screenshot(page, "asks-pane-390");
  });
});
