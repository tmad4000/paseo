import { randomUUID } from "node:crypto";
import { test, expect } from "../support/fixtures";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { renameModalInput, renameModalSubmit } from "../support/helpers/rename";
import type { SeedDaemonClient } from "../support/helpers/seed-client";

const MOBILE_VIEWPORT = { width: 390, height: 844 };

async function fetchAgentTitle(client: SeedDaemonClient, agentId: string): Promise<string | null> {
  const result = await client.fetchAgents({ scope: "active" });
  return result.entries.find((entry) => entry.agent.id === agentId)?.agent.title ?? null;
}

/**
 * Compact "sessions dropdown" rename path. The desktop rename specs drive the right-click
 * `workspace-tab-context-*` menu, which portals into overlay-root and was never broken. This
 * exercises the tab switcher's per-session actions on a phone-sized viewport — the path that
 * regressed when the actions menu presented as a popover instead of a bottom sheet.
 */
test.describe("Workspace session rename (compact tab switcher)", () => {
  test("renames an agent session from the switcher's per-session actions sheet", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await page.setViewportSize(MOBILE_VIEWPORT);
    const initialTitle = `switcher-rename-${randomUUID().slice(0, 8)}`;
    const session = await seedMockAgentWorkspace({
      repoPrefix: "workspace-switcher-rename-",
      title: initialTitle,
    });

    try {
      await openAgentRoute(page, session);
      await expect(page.getByTestId("workspace-tab-switcher-trigger")).toBeVisible({
        timeout: 30_000,
      });

      // Open the sessions dropdown (a bottom sheet on compact).
      await page.getByTestId("workspace-tab-switcher-trigger").click();
      await expect(page.getByRole("button", { name: "Bottom sheet backdrop" }).first()).toBeVisible(
        {
          timeout: 10_000,
        },
      );

      // Open this session's "…" actions. Before the fix this tried to open a popover-Modal
      // that never surfaced over the sheet on native; it now opens as a stacked sheet.
      const menuBase = `workspace-tab-menu-agent_${session.agentId}`;
      const actionsTrigger = page.getByTestId(`${menuBase}-trigger`);
      await expect(actionsTrigger).toBeVisible({ timeout: 15_000 });
      await actionsTrigger.click();

      const renameItem = page.getByTestId(`${menuBase}-rename`);
      await expect(renameItem).toBeVisible({ timeout: 10_000 });
      await renameItem.click();

      const modalPrefix = `workspace-tab-rename-modal-agent-${session.agentId}`;
      const input = renameModalInput(page, modalPrefix);
      await expect(input).toBeVisible({ timeout: 10_000 });
      await expect(input).toHaveValue(initialTitle);

      // A compact modal above the still-open picker owns keyboard focus.
      await input.focus();
      await expect(input).toBeFocused();
      await input.press("ControlOrMeta+A");
      await page.keyboard.type("Cancelled title");
      await expect(input).toHaveValue("Cancelled title");
      await expect(renameModalSubmit(page, modalPrefix)).toBeEnabled();
      await page.keyboard.press("Escape");
      await expect(input).toHaveCount(0);
      const search = page.getByRole("combobox", { name: "Search tabs…" });
      await expect(search).toBeFocused();
      await expect.poll(() => fetchAgentTitle(session.client, session.agentId)).toBe(initialTitle);

      await actionsTrigger.click();
      await renameItem.click();
      await expect(input).toHaveValue(initialTitle);
      await input.focus();
      await expect(input).toBeFocused();
      const renamed = "Renamed from the dropdown";
      await input.press("ControlOrMeta+A");
      await page.keyboard.type(renamed);
      await expect(input).toHaveValue(renamed);
      await expect(renameModalSubmit(page, modalPrefix)).toBeEnabled();
      await renameModalSubmit(page, modalPrefix).click();

      await expect(input).toHaveCount(0, { timeout: 15_000 });
      await expect(page.getByTestId("workspace-tab-switcher-trigger")).toContainText(renamed, {
        timeout: 15_000,
      });
      await expect.poll(() => fetchAgentTitle(session.client, session.agentId)).toBe(renamed);
    } finally {
      await session.cleanup();
    }
  });
});
