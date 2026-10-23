import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildHostWorkspaceOpenRoute, encodeFilePathForPathSegment } from "@/utils/host-routes";
import { getServerId } from "../support/helpers/server-id";
import { test, expect, type Page } from "../support/fixtures";
import { clickNewTerminal, gotoWorkspace } from "../support/helpers/launcher";
import { renameModalInput, renameModalSubmit, renameModalError } from "../support/helpers/rename";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";

async function fetchTerminalTitle(
  workspace: SeededWorkspace,
  terminalId: string,
): Promise<string | null> {
  const result = await workspace.client.listTerminals(workspace.repoPath, undefined, {
    workspaceId: workspace.workspaceId,
  });
  const terminal = result.terminals.find((entry) => entry.id === terminalId);
  return terminal?.title ?? null;
}

async function waitForCreatedTerminalId(workspace: SeededWorkspace): Promise<string> {
  await expect
    .poll(
      async () => {
        const result = await workspace.client.listTerminals(workspace.repoPath, undefined, {
          workspaceId: workspace.workspaceId,
        });
        return result.terminals.map((entry) => entry.id);
      },
      { timeout: 30_000 },
    )
    .toHaveLength(1);
  const result = await workspace.client.listTerminals(workspace.repoPath, undefined, {
    workspaceId: workspace.workspaceId,
  });
  const terminal = result.terminals[0];
  if (!terminal) {
    throw new Error("Expected one created terminal");
  }
  return terminal.id;
}

async function cleanupTerminal(
  workspace: SeededWorkspace,
  terminalId: string | null,
): Promise<void> {
  if (terminalId) {
    await workspace.client.killTerminal(terminalId).catch(() => undefined);
  }
  await workspace.cleanup();
}

async function readClipboard(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

test.describe("Workspace terminal tab rename", () => {
  test("top-bar rename handles terminals and keeps failed edits visible", async ({ page }) => {
    test.setTimeout(120_000);
    const workspace = await seedWorkspace({ repoPrefix: "workspace-header-terminal-rename-" });
    let terminalId: string | null = null;
    try {
      await gotoWorkspace(page, workspace.workspaceId);
      // A launcher has no editable title.
      await page.getByTestId("workspace-header-menu-trigger").filter({ visible: true }).click();
      await expect(page.getByTestId("workspace-header-menu")).toBeVisible();
      await expect(page.getByTestId("workspace-header-rename-tab")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await clickNewTerminal(page);
      terminalId = await waitForCreatedTerminalId(workspace);
      const tab = page.getByTestId(`workspace-tab-terminal_${terminalId}`).first();
      await expect(tab).toBeVisible();
      await page.getByTestId("workspace-header-menu-trigger").filter({ visible: true }).click();
      await page.getByTestId("workspace-header-rename-tab").click();
      const prefix = `workspace-tab-rename-modal-terminal-${terminalId}`;
      const input = renameModalInput(page, prefix);
      await expect(input).toBeVisible();
      await input.fill("Top-bar terminal");
      await renameModalSubmit(page, prefix).click();
      await expect(input).toHaveCount(0);
      await expect(tab).toContainText("Top-bar terminal");
      await expect.poll(() => fetchTerminalTitle(workspace, terminalId!)).toBe("Top-bar terminal");

      await page.getByTestId("workspace-header-menu-trigger").filter({ visible: true }).click();
      await page.getByTestId("workspace-header-rename-tab").click();
      await expect(input).toHaveValue("Top-bar terminal");
      // The real daemon rejects a terminal that disappears while the dialog is open.
      await workspace.client.killTerminal(terminalId);
      await input.fill("Keep this edit");
      await renameModalSubmit(page, prefix).click();
      await expect(renameModalError(page, prefix)).toBeVisible();
      await expect(input).toHaveValue("Keep this edit");
      await expect(renameModalSubmit(page, prefix)).toBeEnabled();
      await page.getByTestId(`${prefix}-cancel`).click();
      await expect(input).toHaveCount(0);
    } finally {
      await cleanupTerminal(workspace, terminalId);
    }
  });

  test("right-click copy terminal id writes the terminal id to the clipboard", async ({
    context,
    page,
  }) => {
    test.setTimeout(60_000);

    const workspace = await seedWorkspace({ repoPrefix: "workspace-terminal-copy-id-" });
    let terminalId: string | null = null;

    try {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await gotoWorkspace(page, workspace.workspaceId);
      await clickNewTerminal(page);
      terminalId = await waitForCreatedTerminalId(workspace);

      const tab = page.getByTestId(`workspace-tab-terminal_${terminalId}`).first();
      await expect(tab).toBeVisible({ timeout: 15_000 });

      await tab.click({ button: "right" });
      const copyTerminalId = page.getByRole("menuitem", {
        name: /^Copy terminal id/,
      });
      await expect(copyTerminalId).toBeVisible({ timeout: 10_000 });
      await copyTerminalId.click();

      await expect.poll(() => readClipboard(page)).toBe(terminalId);
    } finally {
      await cleanupTerminal(workspace, terminalId);
    }
  });

  test("right-click rename persists the terminal title and updates the tab label", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    const workspace = await seedWorkspace({ repoPrefix: "workspace-terminal-rename-" });
    let terminalId: string | null = null;

    try {
      await gotoWorkspace(page, workspace.workspaceId);
      await clickNewTerminal(page);
      terminalId = await waitForCreatedTerminalId(workspace);

      const tab = page.getByTestId(`workspace-tab-terminal_${terminalId}`).first();
      await expect(tab).toBeVisible({ timeout: 15_000 });

      await tab.click({ button: "right" });
      const renameItem = page.getByRole("menuitem", { name: "Rename", exact: true });
      await expect(renameItem).toBeVisible({ timeout: 10_000 });
      await renameItem.click();

      const modalPrefix = `workspace-tab-rename-modal-terminal-${terminalId}`;
      const input = renameModalInput(page, modalPrefix);
      await expect(input).toBeVisible({ timeout: 10_000 });

      await input.fill("My Renamed Terminal");
      await renameModalSubmit(page, modalPrefix).click();

      await expect(input).toHaveCount(0, { timeout: 15_000 });
      await expect(tab).toContainText("My Renamed Terminal", { timeout: 15_000 });
      await expect
        .poll(() => fetchTerminalTitle(workspace, terminalId!))
        .toBe("My Renamed Terminal");
    } finally {
      await cleanupTerminal(workspace, terminalId);
    }
  });
});

test("top-bar links reopen terminal and file targets and handle clipboard errors", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const workspace = await seedWorkspace({ repoPrefix: "workspace-tab-links-" });
  let terminalId: string | null = null;
  try {
    await gotoWorkspace(page, workspace.workspaceId);
    await page.getByTestId("workspace-header-menu-trigger").filter({ visible: true }).click();
    await expect(page.getByTestId("workspace-header-copy-workspace-link")).toBeVisible();
    await expect(page.getByTestId("workspace-header-copy-tab-link")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await clickNewTerminal(page);
    terminalId = await waitForCreatedTerminalId(workspace);
    await page.getByTestId("workspace-header-menu-trigger").filter({ visible: true }).click();
    await page.getByTestId("workspace-header-copy-tab-link").click();
    const terminalLink = new URL(
      buildHostWorkspaceOpenRoute(getServerId(), workspace.workspaceId, `terminal:${terminalId}`),
      page.url(),
    ).href;
    await expect.poll(() => readClipboard(page)).toBe(terminalLink);
    await page.goto("/settings");
    await page.goto(terminalLink);
    await page.waitForURL((url) => !url.searchParams.has("open"));
    await page.getByTestId("workspace-header-menu-trigger").filter({ visible: true }).click();
    await page.getByTestId("workspace-header-rename-tab").click();
    await expect(
      renameModalInput(page, `workspace-tab-rename-modal-terminal-${terminalId}`),
    ).toBeVisible();
    await page.getByTestId(`workspace-tab-rename-modal-terminal-${terminalId}-cancel`).click();
    const path = "a file #日本.txt";
    await writeFile(join(workspace.repoPath, path), "Linked file contents");
    const fileLink = new URL(
      buildHostWorkspaceOpenRoute(
        getServerId(),
        workspace.workspaceId,
        `file:${encodeFilePathForPathSegment(path)}`,
      ),
      page.url(),
    ).href;
    await page.goto(fileLink);
    await page.waitForURL((url) => !url.searchParams.has("open"));
    await expect(page.getByText("Linked file contents", { exact: true })).toBeVisible();
    await page.getByTestId("workspace-header-menu-trigger").filter({ visible: true }).click();
    await page.getByTestId("workspace-header-copy-tab-link").click();
    await expect.poll(() => readClipboard(page)).toBe(fileLink);
    await page.goto("/settings");
    await page.goto(fileLink);
    await expect(page.getByText("Linked file contents", { exact: true })).toBeVisible();
    await page.evaluate(() => {
      Object.defineProperty(navigator.clipboard, "writeText", {
        configurable: true,
        value: () => Promise.reject(new Error("Clipboard unavailable")),
      });
      document.execCommand = () => {
        throw new Error("Clipboard unavailable");
      };
    });
    await page.getByTestId("workspace-header-menu-trigger").filter({ visible: true }).click();
    await page.getByTestId("workspace-header-copy-workspace-link").click();
    await expect(page.getByText("Copy failed", { exact: true })).toBeVisible();
  } finally {
    await cleanupTerminal(workspace, terminalId);
  }
});
