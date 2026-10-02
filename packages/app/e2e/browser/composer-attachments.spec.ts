import { expect, test } from "../support/fixtures";
import { clickNewChat } from "../support/helpers/launcher";
import { expectComposerVisible } from "../support/helpers/composer";
import { expectAgentIdle } from "../support/helpers/agent-stream";
import {
  openAttachmentMenu,
  expectAttachmentSheetRowsOnTitleRail,
  openGithubPickerFromMenu,
  attachImageFromMenu,
  expectAttachmentPill,
  removeAttachmentPill,
  openImageLightbox,
  closeImageLightbox,
  pressInterruptShortcut,
  expectComposerDraft,
  expectComposerDisabled,
  expectComposerEditable,
  expectAttachButtonDisabled,
  fillComposerDraft,
  dropFileOnComposer,
  sendDraftToQueue,
  expectQueuedMessageButton,
  startRunningMockAgent,
  selectGithubOption,
  expectGithubAttachmentPill,
  openGithubWorkspace,
} from "../support/helpers/composer";
import {
  delayBrowserAgentCreatedStatus,
  openNewWorkspaceComposer,
} from "../support/helpers/new-workspace";
import { gotoAppShell } from "../support/helpers/app";
import {
  waitForSidebarHydration,
  switchWorkspaceViaSidebar,
} from "../support/helpers/workspace-ui";
import { seedWorkspace } from "../support/helpers/seed-client";
import { hasGithubAuth, createTempGithubRepo } from "../support/helpers/github-fixtures";
import { getServerId } from "../support/helpers/server-id";
import { installDaemonWebSocketGate } from "../support/helpers/daemon-websocket-gate";
import { openFileExplorer } from "../support/helpers/file-explorer";
import { attachFileFromMenu, controlFileUploadCompletion } from "../support/helpers/composer";

const MINIMAL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

const TEST_IMAGE = { name: "test.png", mimeType: "image/png", buffer: MINIMAL_PNG };
const TEST_JSON = {
  name: "config.json",
  mimeType: "application/json",
  buffer: Buffer.from(JSON.stringify({ composer: "drop" })),
};

test.describe("Composer attachments", () => {
  test("selected file shows a loading attachment until upload is acknowledged", async ({
    page,
    withWorkspace,
  }) => {
    const upload = await controlFileUploadCompletion(page);
    const workspace = await withWorkspace({ prefix: "attach-upload-pending-" });
    await workspace.navigateTo();
    await clickNewChat(page);
    await expectComposerVisible(page);

    upload.hold();
    await attachFileFromMenu(page, TEST_JSON);
    await upload.waitForUpload();

    const pending = page.getByTestId("composer-pending-file-attachment");
    await expect(pending).toContainText(TEST_JSON.name);
    await expect(pending.getByRole("progressbar")).toBeVisible();
    await expect(page.getByTestId("composer-file-attachment-pill")).toHaveCount(0);

    upload.complete();
    await expect(pending).toHaveCount(0);
    await expect(page.getByTestId("composer-file-attachment-pill")).toContainText(TEST_JSON.name);
    await expectComposerEditable(page);
  });

  test("compact Plus menu aligns attachment rows with its sheet title", async ({
    page,
    withWorkspace,
  }) => {
    test.setTimeout(60_000);
    const workspace = await withWorkspace({ prefix: "attach-sheet-rails-" });
    await workspace.navigateTo();
    await clickNewChat(page);
    await expectComposerVisible(page);
    await page.setViewportSize({ width: 390, height: 844 });

    await openAttachmentMenu(page);

    await expectAttachmentSheetRowsOnTitleRail(page);
  });

  test("GitHub combobox does not render until the picker is opened", async ({
    page,
    withWorkspace,
  }) => {
    test.setTimeout(60_000);
    const workspace = await withWorkspace({ prefix: "attach-gh-lazy-" });
    await workspace.navigateTo();
    await clickNewChat(page);
    await expectComposerVisible(page);

    await expect(page.getByTestId("combobox-desktop-container")).not.toBeVisible();

    await openGithubPickerFromMenu(page);

    await expect(page.getByPlaceholder("Search issues and PRs...")).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByTestId("combobox-empty-text").or(page.getByText("Searching...")),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("attaches an issue and a pull request from the repository picker", async ({ page }) => {
    test.setTimeout(120_000);
    if (!hasGithubAuth()) {
      test.skip(true, "GitHub auth not available in this environment");
    }
    const ghRepo = await createTempGithubRepo({
      category: "attachments",
      issues: [{ title: "fix: attachment issue" }],
      prs: [{ title: "feat: attachment pull request", state: "open" }],
    });
    const handle = await openGithubWorkspace(page, ghRepo.prs[0].localPath);
    try {
      await clickNewChat(page);
      await expectComposerVisible(page);
      // Choose from the repository list. Newly created repositories are not
      // necessarily available in GitHub's separate text-search index yet.
      await selectGithubOption(page, "", `issue:${ghRepo.issues[0].number}`);
      await expectGithubAttachmentPill(page, ghRepo.issues[0]);
      await selectGithubOption(page, "", `change_request:${ghRepo.prs[0].number}`);
      await expectGithubAttachmentPill(page, ghRepo.prs[0]);
      await expectGithubAttachmentPill(page, ghRepo.issues[0]);
    } finally {
      await handle.cleanup();
      await ghRepo.cleanup();
    }
  });

  test.fixme("workspace-review pill suppresses on X-click and reappears after send", async () => {
    // The review attachment is created via InlineReviewEditor in surface.tsx (addComment action).
    // Automating this requires: a workspace with staged changes, navigating to the diff panel,
    // hovering the gutter "+" button, typing a comment, and submitting. A dedicated
    // helpers/review.ts with addInlineReviewComment(page, filePath, lineNumber, comment) is
    // needed before this can be exercised end-to-end.
  });

  test("attaches, previews, and removes an image before dropping a file", async ({
    page,
    withWorkspace,
  }) => {
    test.setTimeout(60_000);
    const workspace = await withWorkspace({ prefix: "attach-lightbox-" });
    await workspace.navigateTo();
    await clickNewChat(page);
    await expectComposerVisible(page);

    await test.step("open the available attachment choices", async () => {
      await openAttachmentMenu(page);
      await expect(page.getByTestId("message-input-attachment-menu-item-image")).toBeVisible();
      await expect(page.getByTestId("message-input-attachment-menu-item-github")).toBeVisible();
      await page.keyboard.press("Escape");
    });

    await attachImageFromMenu(page, TEST_IMAGE);
    await expectAttachmentPill(page, "composer-image-attachment-pill");

    await openImageLightbox(page);
    await closeImageLightbox(page);

    await test.step("remove the image and attach a dropped file", async () => {
      await removeAttachmentPill(page, "composer-image-attachment-pill", "Remove image attachment");
      await expect(page.getByTestId("composer-image-attachment-pill")).toHaveCount(0);
      await dropFileOnComposer(page, TEST_JSON);
      await expectAttachmentPill(page, "composer-file-attachment-pill");
    });
  });

  test("dropped JSON file renders as a file attachment in New Workspace", async ({ page }) => {
    test.setTimeout(120_000);
    const workspace = await seedWorkspace({ repoPrefix: "attach-drop-new-workspace-" });

    try {
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await switchWorkspaceViaSidebar({
        page,
        serverId: getServerId(),
        workspaceId: workspace.workspaceId,
      });

      await openNewWorkspaceComposer(page, {
        projectKey: workspace.projectKey,
        projectDisplayName: workspace.projectDisplayName,
      });

      await dropFileOnComposer(page, TEST_JSON);

      await expectAttachmentPill(page, "composer-file-attachment-pill");
    } finally {
      await workspace.cleanup();
    }
  });

  test("submitting while agent is running queues the message and clears the draft", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const agent = await startRunningMockAgent(page, {
      prefix: "attach-queue-",
      model: "one-minute-stream",
      prompt: "Stay running for queue test.",
    });
    try {
      await fillComposerDraft(page, "queued draft text");
      await sendDraftToQueue(page);

      await expectQueuedMessageButton(page);
      await expectComposerDraft(page, "");
    } finally {
      await agent.cleanup();
    }
  });

  test("editing a queued message preserves its attachments and queue position", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const agent = await startRunningMockAgent(page, {
      prefix: "attach-queue-edit-",
      model: "thirty-minute-stream",
      prompt: "Stay running while a disposable queued message is edited.",
    });
    try {
      await fillComposerDraft(page, "Original queued text");
      await attachImageFromMenu(page, TEST_IMAGE);
      await expectAttachmentPill(page, "composer-image-attachment-pill");
      await sendDraftToQueue(page);
      await expectQueuedMessageButton(page);
      await expectComposerDraft(page, "");

      await fillComposerDraft(page, "Second queued text");
      await sendDraftToQueue(page);
      await expectComposerDraft(page, "");
      await expect
        .poll(async () => (await agent.client.listQueuedAgentMessages(agent.agentId)).items.length)
        .toBe(2);
      const before = await agent.client.listQueuedAgentMessages(agent.agentId);
      expect(before.items[0]?.images).toHaveLength(1);

      await page.getByRole("button", { name: "Edit queued message" }).first().click();
      const queuedEditor = page.getByRole("textbox", { name: "Edit queued message" });
      await expect(queuedEditor).toHaveValue("Original queued text");
      await queuedEditor.fill("Revised queued text");
      await page.getByRole("button", { name: "Save queued message" }).click();
      await expect(queuedEditor).toHaveCount(0);
      await expectComposerDraft(page, "");

      const after = await agent.client.listQueuedAgentMessages(agent.agentId);
      expect(after.items.map((item) => item.id)).toEqual(before.items.map((item) => item.id));
      expect(after.items.map((item) => item.text)).toEqual([
        "Revised queued text",
        "Second queued text",
      ]);
      expect(after.items[0]?.images).toEqual(before.items[0]?.images);
    } finally {
      await agent.cleanup();
    }
  });

  test("a disconnected queued Edit keeps the message available for retry", async ({ page }) => {
    test.setTimeout(120_000);
    const gate = await installDaemonWebSocketGate(page);
    const agent = await startRunningMockAgent(page, {
      prefix: "attach-queue-edit-retry-",
      model: "thirty-minute-stream",
      prompt: "Stay running while a disposable queued Edit disconnects.",
    });
    try {
      await fillComposerDraft(page, "Keep this queued message");
      await sendDraftToQueue(page);
      await expect
        .poll(async () => (await agent.client.listQueuedAgentMessages(agent.agentId)).items.length)
        .toBe(1);
      const edit = page.getByRole("button", { name: "Edit queued message" });
      await edit.click();
      const queuedEditor = page.getByRole("textbox", { name: "Edit queued message" });
      await queuedEditor.fill("Retried queued message");
      gate.holdNextServerMessage("agent.queue.edit.response");
      await page.getByRole("button", { name: "Save queued message" }).click();
      await gate.waitForHeldServerMessage("agent.queue.edit.response");
      await gate.drop();
      await expect(
        page.getByRole("alert").filter({ hasText: /^Dropped by reconnect test\.$/ }),
      ).toBeVisible();
      await expect(queuedEditor).toHaveValue("Retried queued message");
      await expectComposerDraft(page, "");
      expect(
        (await agent.client.listQueuedAgentMessages(agent.agentId)).items.map((item) => item.text),
      ).toEqual(["Retried queued message"]);

      gate.restoreFresh();
      await gate.waitForServerMessage("fetch_agent_timeline_response", 2);
      await page.getByRole("button", { name: "Save queued message" }).click();
      await expect(queuedEditor).toHaveCount(0);
      await expect
        .poll(
          async () => (await agent.client.listQueuedAgentMessages(agent.agentId)).items[0]?.text,
        )
        .toBe("Retried queued message");
    } finally {
      gate.restore();
      await agent.cleanup();
    }
  });

  test("queued controls save on leave, remove only one item, and expose long text at desktop and phone width", async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    const agent = await startRunningMockAgent(page, {
      prefix: "queue-controls-",
      model: "thirty-minute-stream",
      prompt: "Stay running for isolated queue controls.",
    });
    try {
      await fillComposerDraft(page, "Original edit text");
      await attachImageFromMenu(page, TEST_IMAGE);
      await sendDraftToQueue(page);
      await expectComposerDraft(page, "");
      const longText = Array.from(
        { length: 60 },
        (_, index) => `Queued line ${index + 1}: fully readable at phone width.`,
      ).join("\n");
      await fillComposerDraft(page, longText);
      await sendDraftToQueue(page);
      await expectComposerDraft(page, "");
      await expect
        .poll(async () => (await agent.client.listQueuedAgentMessages(agent.agentId)).items.length)
        .toBe(2);
      const before = await agent.client.listQueuedAgentMessages(agent.agentId);
      await page.getByRole("button", { name: "Edit queued message" }).first().click();
      const editor = page.getByRole("textbox", { name: "Edit queued message" });
      await editor.fill("Saved by leaving the editor");
      await page.getByRole("button", { name: "Done editing queued message" }).click();
      await expect(editor).toHaveCount(0);
      const saved = await agent.client.listQueuedAgentMessages(agent.agentId);
      expect(saved.items.map((item) => item.id)).toEqual(before.items.map((item) => item.id));
      expect(saved.items[0]?.text).toBe("Saved by leaving the editor");
      expect(saved.items[0]?.images).toEqual(before.items[0]?.images);
      const longRow = page.getByTestId(`queued-message-${before.items[1]!.id}`);
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 844 });
        await page.evaluate(async () => {
          await document.fonts.ready;
          await new Promise<number>(requestAnimationFrame);
          await new Promise<number>(requestAnimationFrame);
        });
        const expand = longRow.getByRole("button", { name: "Expand or collapse queued message" });
        const endText = longRow.getByText(longText, { exact: true });
        const scroll = page.getByTestId("composer-queue-list");
        if (
          await endText.evaluate((element) => getComputedStyle(element).webkitLineClamp !== "none")
        )
          await expand.click();
        await expect(endText).toBeVisible();
        const textMetrics = await endText.evaluate((element) => ({
          lineClamp: getComputedStyle(element).webkitLineClamp,
          fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
          height: element.clientHeight,
        }));
        expect(textMetrics.lineClamp).toBe("none");
        expect(textMetrics.height).toBeGreaterThanOrEqual(60 * textMetrics.fontSize);
        await scroll.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
        expect(
          await scroll.evaluate((element) => element.scrollHeight > element.clientHeight),
        ).toBe(true);
        const bounds = await endText.boundingBox();
        const scrollBounds = await scroll.boundingBox();
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(
          scrollBounds!.y + scrollBounds!.height + 2,
        );
        await page.screenshot({ path: testInfo.outputPath(`queue-controls-${width}.png`) });
      }
      await page.setViewportSize({ width: 1280, height: 844 });
      await page
        .getByTestId(`queued-message-${before.items[0]!.id}`)
        .getByRole("button", { name: "Remove queued message" })
        .click();
      await expect
        .poll(async () => (await agent.client.listQueuedAgentMessages(agent.agentId)).items)
        .toHaveLength(1);
      await expect(page.getByTestId(`queued-message-${before.items[0]!.id}`)).toHaveCount(0);
      expect((await agent.client.listQueuedAgentMessages(agent.agentId)).items[0]?.text).toBe(
        longText,
      );
    } finally {
      await agent.cleanup();
    }
  });

  test("an old queued save cannot clear a newer draft after collapse and reopen", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const gate = await installDaemonWebSocketGate(page);
    const responseReceived = new Promise<void>((resolve) => {
      page.on("websocket", (socket) => {
        socket.on("framereceived", ({ payload }) => {
          try {
            const envelope = JSON.parse(typeof payload === "string" ? payload : payload.toString());
            if ((envelope.message ?? envelope).type === "agent.queue.edit.response") resolve();
          } catch {}
        });
      });
    });
    const agent = await startRunningMockAgent(page, {
      prefix: "queue-save-ownership-",
      model: "thirty-minute-stream",
      prompt: "Stay running for isolated draft ownership.",
    });
    try {
      await attachImageFromMenu(page, TEST_IMAGE);
      await fillComposerDraft(page, "Original queued baseline");
      await sendDraftToQueue(page);
      await expect
        .poll(async () => (await agent.client.listQueuedAgentMessages(agent.agentId)).items.length)
        .toBe(1);
      const original = (await agent.client.listQueuedAgentMessages(agent.agentId)).items[0]!;
      const draftKey = `queued-edit:${getServerId()}:${agent.agentId}:${original.id}`;
      const readCheckpoint = () =>
        page.evaluate((key) => {
          const saved = JSON.parse(localStorage.getItem("paseo-drafts") ?? "{}");
          return {
            draft: saved.state?.drafts?.[key],
            baseline: saved.state?.drafts?.[`${key}:baseline`],
          };
        }, draftKey);
      await page.getByRole("button", { name: "Edit queued message" }).click();
      const editor = page.getByRole("textbox", { name: "Edit queued message" });
      await editor.fill("Pending save B");
      gate.holdNextServerMessage("agent.queue.edit.response");
      await page.getByRole("button", { name: "Save queued message" }).click();
      await gate.waitForHeldServerMessage("agent.queue.edit.response");
      await page.getByTestId("composer-queue-toggle").click();
      await expect(editor).toHaveCount(0);
      await page.getByTestId("composer-queue-toggle").click();
      await expect(editor).toHaveValue("Pending save B");
      const attachmentScans: string[] = [];
      const recordAttachmentScan = (message: import("@playwright/test").ConsoleMessage) => {
        if (message.text() === "queued-edit-attachment-scan") attachmentScans.push(message.text());
      };
      page.on("console", recordAttachmentScan);
      await page.evaluate(() => {
        const openCursor = IDBObjectStore.prototype.openCursor;
        IDBObjectStore.prototype.openCursor = function (...args) {
          if (
            this.transaction.db.name === "paseo-attachment-bytes" &&
            this.name === "attachments"
          ) {
            console.debug("queued-edit-attachment-scan");
          }
          return openCursor.apply(this, args);
        };
      });
      const beforeTyping = await readCheckpoint();
      await editor.fill("");
      await expect.poll(readCheckpoint).toMatchObject({
        draft: { lifecycle: "active", input: { text: "" } },
        baseline: beforeTyping.baseline,
      });
      await editor.pressSequentially("Newer checkpoint C");
      await expect.poll(readCheckpoint).toMatchObject({
        draft: { lifecycle: "active", input: { text: "Newer checkpoint C" } },
        baseline: { lifecycle: "active", input: { text: original.text } },
      });
      expect((await readCheckpoint()).baseline).toEqual(beforeTyping.baseline);
      expect(attachmentScans).toEqual([]);
      page.off("console", recordAttachmentScan);
      gate.releaseHeldServerMessage("agent.queue.edit.response");
      await responseReceived;
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          }),
      );
      await expect(editor).toHaveValue("Newer checkpoint C");
      expect(await readCheckpoint()).toMatchObject({
        draft: { lifecycle: "active", input: { text: "Newer checkpoint C" } },
        baseline: { lifecycle: "active", input: { text: original.text } },
      });
      const saved = (await agent.client.listQueuedAgentMessages(agent.agentId)).items;
      expect(saved.map((item) => item.id)).toEqual([original.id]);
      expect(saved[0]?.text).toBe("Pending save B");
      expect(saved[0]?.images).toEqual(original.images);
      await page.reload();
      await expect.poll(readCheckpoint).toMatchObject({
        draft: { lifecycle: "active", input: { text: "Newer checkpoint C" } },
        baseline: { lifecycle: "active", input: { text: original.text } },
      });
    } finally {
      gate.restore();
      await agent.cleanup();
    }
  });

  test("leaving a stale queued edit preserves the changed draft for retry", async ({ page }) => {
    test.setTimeout(120_000);
    const agent = await startRunningMockAgent(page, {
      prefix: "queue-stale-leave-",
      model: "thirty-minute-stream",
      prompt: "Stay running for isolated stale edit.",
    });
    try {
      await fillComposerDraft(page, "Original queued baseline");
      await sendDraftToQueue(page);
      await expect
        .poll(async () => (await agent.client.listQueuedAgentMessages(agent.agentId)).items.length)
        .toBe(1);
      const item = (await agent.client.listQueuedAgentMessages(agent.agentId)).items[0]!;
      await page.getByRole("button", { name: "Edit queued message" }).click();
      const editor = page.getByRole("textbox", { name: "Edit queued message" });
      await editor.fill("Local edit stays recoverable");
      await agent.client.editQueuedAgentMessage({
        agentId: agent.agentId,
        itemId: item.id,
        expectedText: item.text,
        text: "Changed on another device",
      });
      await page.getByRole("button", { name: "Done editing queued message" }).click();
      await expect(
        page.getByRole("alert").filter({ hasText: "This queued message changed" }),
      ).toBeVisible();
      await expect(editor).toHaveValue("Local edit stays recoverable");
      expect((await agent.client.listQueuedAgentMessages(agent.agentId)).items[0]?.text).toBe(
        "Changed on another device",
      );
    } finally {
      await agent.cleanup();
    }
  });

  test("offline queued removal retains its durable pending state across reload", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const gate = await installDaemonWebSocketGate(page);
    const agent = await startRunningMockAgent(page, {
      prefix: "queue-offline-remove-",
      model: "thirty-minute-stream",
      prompt: "Stay running for isolated cancellation.",
    });
    try {
      gate.holdNextServerMessage("agent.queue.enqueue.response");
      await fillComposerDraft(page, "Accepted by host but response lost");
      await sendDraftToQueue(page);
      await gate.waitForHeldServerMessage("agent.queue.enqueue.response");
      await gate.drop();
      await expect(
        page.getByText("Accepted by host but response lost", { exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Remove queued message" }).click();
      await expect(
        page.getByText("Removal pending — waiting for host", { exact: true }),
      ).toBeVisible();
      expect(
        (await agent.client.listQueuedAgentMessages(agent.agentId)).items.map((item) => item.text),
      ).toEqual(["Accepted by host but response lost"]);
      const itemId = (await agent.client.listQueuedAgentMessages(agent.agentId)).items[0]!.id;
      const readSavedCancellation = () =>
        page.evaluate((id) => {
          const saved = JSON.parse(localStorage.getItem("paseo-queue-outbox") ?? "{}");
          return saved.state?.entries?.[id];
        }, itemId);
      await expect.poll(readSavedCancellation).toMatchObject({ itemId, removalRequested: true });
      await page.reload();
      await expect.poll(readSavedCancellation).toMatchObject({ itemId, removalRequested: true });
      expect(
        (await agent.client.listQueuedAgentMessages(agent.agentId)).items.map((item) => item.id),
      ).toEqual([itemId]);
    } finally {
      gate.restore();
      await agent.cleanup();
    }
  });

  test("Escape interrupt cancels the running agent and preserves composer draft", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const agent = await startRunningMockAgent(page, {
      prefix: "attach-interrupt-",
      model: "ten-second-stream",
      prompt: "Stay running for interrupt test.",
    });
    try {
      await fillComposerDraft(page, "preserve me");
      await pressInterruptShortcut(page);

      await expectAgentIdle(page, 15_000);
      await expectComposerDraft(page, "preserve me");
    } finally {
      await agent.cleanup();
    }
  });

  test("Escape cancels file creation without interrupting the running agent", async ({ page }) => {
    test.setTimeout(120_000);
    const agent = await startRunningMockAgent(page, {
      prefix: "file-create-escape-",
      model: "one-minute-stream",
      prompt: "Stay running while a file draft is cancelled.",
    });
    try {
      await openFileExplorer(page);
      await page.getByTestId("files-new-file").click();
      const nameInput = page.getByTestId("file-explorer-name-input");
      await expect(nameInput).toBeVisible();

      await nameInput.press("Escape");

      await expect(nameInput).toBeHidden();
      await expect(page.getByRole("button", { name: /stop|cancel/i }).first()).toBeVisible();
    } finally {
      await agent.cleanup();
    }
  });

  test("composer is locked while new workspace agent is being created", async ({ page }) => {
    test.setTimeout(120_000);
    const serverId = getServerId();

    const agentCreatedDelay = await delayBrowserAgentCreatedStatus(page);
    const workspace = await seedWorkspace({ repoPrefix: "attach-lock-" });

    try {
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await switchWorkspaceViaSidebar({
        page,
        serverId,
        workspaceId: workspace.workspaceId,
      });

      await openNewWorkspaceComposer(page, {
        projectKey: workspace.projectKey,
        projectDisplayName: workspace.projectDisplayName,
      });
      await fillComposerDraft(page, "lock test prompt");
      const createButton = page
        .getByTestId("message-input-root")
        .getByRole("button", { name: "Create" });
      await expect(createButton).toBeVisible({ timeout: 30_000 });
      await createButton.click();

      await agentCreatedDelay.waitForCreateRequest();
      await agentCreatedDelay.waitForDelayedCreatedStatus();

      await expectComposerDisabled(page);
      await expectAttachButtonDisabled(page);

      agentCreatedDelay.release();

      await expectComposerEditable(page);
    } finally {
      agentCreatedDelay.release();
      await workspace.cleanup();
    }
  });
});
