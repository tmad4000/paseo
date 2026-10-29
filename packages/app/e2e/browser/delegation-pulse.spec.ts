import { expect, test } from "../support/fixtures";
import { expectComposerVisible } from "../support/helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

/**
 * A delegating chat watches its children live: the open-asks pane and the Stream card show each
 * child's state from the host's agent pushes, an idle child reads as an open loop, and both ends
 * link to each other.
 */
test("Delegated asks pulse live in the delegating chat and link both ways", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const orchestrator = await seedMockAgentWorkspace({
    repoPrefix: "delegation-pulse-",
    title: "Orchestrator",
  });
  try {
    const { client } = orchestrator;
    const fixer = await client.createAgent({
      provider: "mock",
      cwd: orchestrator.cwd,
      workspaceId: orchestrator.workspaceId,
      title: "Fix worker",
      modeId: "load-test",
      model: "one-minute-stream",
      initialPrompt: "Fix the failing deploy.",
    });
    const docs = await client.createAgent({
      provider: "mock",
      cwd: orchestrator.cwd,
      workspaceId: orchestrator.workspaceId,
      title: "Docs worker",
      modeId: "load-test",
      model: "e2e-fast-stream",
    });
    await client.waitForAgentUpsert(fixer.id, (s) => s.status === "running", 30_000);
    await client.waitForAgentUpsert(docs.id, (s) => s.status === "idle", 30_000);
    // The host stores each as `ask:<id>`.
    const asks = [
      { id: "deploy", text: "Deploy the fix once the worker finishes", child: fixer.id },
      { id: "docs", text: "Update the deploy runbook", child: docs.id },
    ];
    for (const item of asks) {
      await client.updateStreamEntry({
        agentId: orchestrator.agentId,
        action: "set_ask",
        entryId: item.id,
        text: item.text,
        expectedRevision: 0,
        ask: {
          state: "in_progress",
          remaining: "Waiting on the child.",
          evidence: "",
          delegatedAgentId: item.child,
        },
      });
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await openAgentRoute(page, orchestrator);
    await expectComposerVisible(page);
    const pane = page.getByTestId("tracked-answers-pane");
    const toggle = pane.getByTestId("tracked-answers-toggle");
    const deploy = pane.getByTestId("open-ask-ask:deploy");
    const docsRow = pane.getByTestId("open-ask-ask:docs");

    // Running child: blue pulse; idle child with the ask still open: flagged for the delegator.
    await expect(deploy.getByTestId("open-ask-owner")).toContainText("Fix worker");
    await expect(deploy.getByTestId("open-ask-owner-status")).toHaveText(/^Running/);
    await expect(docsRow.getByTestId("open-ask-owner-status")).toHaveText(
      /^Idle.* · ask still open$/,
    );
    await expect(toggle).toHaveAccessibleName(/2 open asks · 1 needs attention/);
    await page.screenshot({ path: testInfo.outputPath("pulse-running.png") });

    // The child stops: the delegating chat follows from the push, with no reload or reopen.
    await client.cancelAgent(fixer.id);
    await expect(deploy.getByTestId("open-ask-owner-status")).toHaveText(
      /^Idle.* · ask still open$/,
      { timeout: 30_000 },
    );
    await expect(toggle).toHaveAccessibleName(/2 open asks · 2 need attention/);
    await page.screenshot({ path: testInfo.outputPath("pulse-idle.png") });

    // The ask's Stream card shows the same live line without expanding it.
    await docsRow.getByTestId("open-ask-open").click();
    await expect(page.getByTestId("local-stream-workflow")).toBeVisible();
    const card = page
      .getByTestId("local-stream-workflow")
      .getByTestId("companion-entry-delegation")
      .filter({ hasText: "Docs worker" });
    await expect(card).toBeVisible();
    await expect(card).toContainText("ask still open");
    await page.screenshot({ path: testInfo.outputPath("pulse-stream-card.png") });

    // One click to the child (a tab in this workspace); it links back to the ask it works.
    await card.click();
    const childPane = page.getByTestId("tracked-answers-pane").filter({ visible: true });
    const backRow = childPane.getByTestId(`delegated-here-${orchestrator.agentId}-ask:docs`);
    await expect(childPane.getByText("Delegated to this chat · 1")).toBeVisible({
      timeout: 30_000,
    });
    await expect(backRow.getByText("from Orchestrator")).toBeVisible();
    await expect(backRow.getByText("Update the deploy runbook")).toBeVisible();
    await expect(page.getByTestId(`workspace-tab-agent_${docs.id}`).first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("pulse-child-backlink.png") });

    // Back in the delegating chat, on that ask's card in its Stream.
    await backRow.getByTestId("delegated-here-open").click();
    await expect(page.getByTestId("global-stream-search").filter({ visible: true })).toHaveValue(
      "Update the deploy runbook",
      { timeout: 30_000 },
    );
    await expect(
      page
        .getByTestId("local-stream-workflow")
        .filter({ visible: true })
        .getByTestId("companion-entry-delegation")
        .filter({ hasText: "Docs worker" }),
    ).toBeVisible();
  } finally {
    await orchestrator.cleanup();
  }
});
