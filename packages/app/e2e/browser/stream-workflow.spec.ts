import { expect, test } from "../support/fixtures";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { getServerId } from "../support/helpers/server-id";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";

for (const width of [390, 1440]) {
  test(`shared Tasks, Q&A and Needs you preserve independent state at ${width}px`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    page.setDefaultTimeout(15_000);
    const owner = await seedMockAgentWorkspace({
      repoPrefix: "stream-workflow-",
      title: "Workflow origin",
    });
    const worker = await seedMockAgentWorkspace({
      repoPrefix: "stream-worker-",
      title: "Workflow worker",
    });
    const serverId = getServerId();
    let rejectSeen = true;
    await page.routeWebSocket(daemonWsRoutePattern(), (browser) => {
      const server = browser.connectToServer();
      browser.onMessage((message) => {
        if (typeof message === "string") {
          const envelope = JSON.parse(message);
          const request = envelope.type === "session" ? envelope.message : null;
          if (
            request?.type === "stream.entry.update.request" &&
            request.action === "mark_reply_seen" &&
            rejectSeen
          ) {
            rejectSeen = false;
            browser.send(
              JSON.stringify({
                type: "session",
                message: {
                  type: "rpc_error",
                  payload: {
                    requestId: request.requestId,
                    requestType: request.type,
                    error: "Seen save failed. Retry.",
                    code: "handler_error",
                  },
                },
              }),
            );
            return;
          }
        }
        server.send(message);
      });
      server.onMessage((message) => browser.send(message));
    });
    try {
      const task = {
        state: "in_progress" as const,
        remaining: "Finish validation",
        evidence: "",
        expectsAnswer: true,
        sessions: [{ serverId, agentId: worker.agentId }],
        subtasks: [{ id: "choice", text: "Choose direction", done: false }],
      };
      await owner.client.updateStreamEntry({
        agentId: owner.agentId,
        action: "set_ask",
        entryId: "global",
        expectedRevision: 0,
        text: `Canonical task ${width}: what changed?`,
        ask: task,
      });
      const ref = { serverId, agentId: owner.agentId, entryId: "ask:global" };
      for (const id of ["choice", "date"])
        await owner.client.updateStreamEntry({
          agentId: owner.agentId,
          action: "add_question",
          entryId: id,
          text: `Please choose ${id} ${width}`,
          inputRequest: { kind: "decision", recipient: "user", task: ref, subtaskId: "choice" },
        });
      await owner.client.updateStreamEntry({
        agentId: owner.agentId,
        action: "set_reply",
        entryId: "ask:global",
        text: `Verified result ${width}`,
        replyRevision: 0,
      });
      await page.setViewportSize({ width, height: 950 });
      await openAgentRoute(page, worker);
      await page.getByTestId("agent-view-artifacts").click();
      const local = page.getByTestId("local-stream-workflow");
      const localRows = local.getByTestId(`global-stream-row-${owner.agentId}`);
      await local.getByText("Tasks", { exact: true }).click();
      await expect(localRows.getByTestId("companion-entry-ask:global")).toBeVisible();
      await local.getByTestId("stream-needs-you").click();
      await expect(localRows.getByTestId("companion-entry-question:choice")).toBeVisible();
      await expect(localRows.getByTestId("companion-entry-question:date")).toBeVisible();
      await expect(localRows.getByTestId("companion-entry-ask:global")).toHaveCount(0);
      await page.screenshot({
        path: testInfo.outputPath(`needs-you-local-${width}.png`),
        fullPage: true,
      });

      // Opening, expanding and changing scope does not resolve a dependency.
      // Needs you's triage row: Reply, Later, Details, More. Details only expands.
      await localRows
        .getByTestId("companion-entry-question:choice")
        .getByRole("button", { name: "Details", exact: true })
        .click();
      await local.getByTestId("stream-scope").click();
      expect(
        (await owner.client.listGlobalStream({ view: "needs_you", agentId: owner.agentId })).rows,
      ).toHaveLength(2);
      await localRows
        .getByTestId("companion-entry-question:choice")
        .getByTestId("companion-entry-more")
        .click();
      await page.getByRole("menuitem", { name: "Done", exact: true }).click();
      await expect(localRows.getByTestId("companion-entry-question:choice")).toHaveCount(0);
      await expect(localRows.getByTestId("companion-entry-question:date")).toBeVisible();

      await page.goto("/stream?view=questions", { waitUntil: "commit" });
      const global = page.getByTestId("global-stream");
      const globalRows = global.getByTestId(`global-stream-row-${owner.agentId}`);
      const answer = globalRows.getByTestId("companion-entry-ask:global");
      await expect(answer.getByText(`Verified result ${width}`, { exact: true })).toBeVisible();
      await globalRows.getByTestId("stream-mark-answer-seen").click();
      await expect(
        globalRows.getByRole("alert").filter({ hasText: "Seen save failed. Retry." }),
      ).toBeVisible();
      await expect(globalRows.getByTestId("stream-mark-answer-seen")).toBeEnabled();
      await globalRows.getByTestId("stream-mark-answer-seen").click();
      await expect(globalRows.getByTestId("stream-mark-answer-seen")).toHaveCount(0);
      const rows = await owner.client.listGlobalStream({ view: "tasks", agentId: owner.agentId });
      const entry = rows.rows[0].item;
      expect(entry.kind).toBe("entry");
      if (entry.kind !== "entry") throw new Error("Missing task");
      expect(entry.entry.ask?.state).toBe("in_progress");
      expect(entry.entry.replySeenRevision).toBe(1);
      await global.getByTestId("stream-needs-you").click();
      await expect(globalRows.getByTestId("companion-entry-question:date")).toBeVisible();
      await expect(globalRows.getByTestId("companion-entry-ask:global")).toHaveCount(0);
      await page.screenshot({
        path: testInfo.outputPath(`needs-you-global-${width}.png`),
        fullPage: true,
      });
    } finally {
      await worker.cleanup();
      await owner.cleanup();
    }
    // Global attention stays reachable after the last project is removed.
    await page.goto("/stream", { waitUntil: "commit" });
    if (width === 390) await page.getByRole("button", { name: "Open menu", exact: true }).click();
    await expect(page.getByTestId("sidebar-needs-you")).toBeVisible();
    await page.getByTestId("sidebar-needs-you").click();
    await expect(page).toHaveURL(/view=needs_you/);
    if (width === 390) await expect(page.getByTestId("sidebar-needs-you")).toBeHidden();
    await page.screenshot({
      path: testInfo.outputPath(`needs-you-empty-projects-${width}.png`),
      fullPage: true,
    });
  });
}
