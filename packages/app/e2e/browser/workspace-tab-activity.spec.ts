import { randomUUID } from "node:crypto";
import { test, expect } from "../support/fixtures";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { seedAppSettings } from "../support/helpers/read-on-open";

// These flows opt into "Sort tabs by recent activity"; the fork default keeps tab order stable
// (see the stable-order test at the end of this file).
// Read on open: visiting the tab reads it. Explicit (the default): the visit leaves the dot,
// and the tab's own check (desktop) or its switcher row's check (phone) reads it.
for (const mode of ["read on open", "explicit read"] as const)
  for (const viewport of [
    { name: "desktop", width: 1280, height: 800 },
    { name: "phone width", width: 390, height: 844 },
  ]) {
    const title =
      mode === "read on open"
        ? `background tab activity is ordered and clears on visit at ${viewport.name}`
        : `background tab activity is ordered and stays unread after a visit until read at ${viewport.name}`;
    test(title, async ({ page }) => {
      test.setTimeout(120_000);
      await seedAppSettings(page, {
        sortTabsByActivity: true,
        ...(mode === "read on open" ? { markReadOnOpen: true } : {}),
      });
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const session = await seedMockAgentWorkspace({
        repoPrefix: "workspace-tab-activity-",
        title: `first-${randomUUID().slice(0, 6)}`,
      });
      try {
        const second = await session.client.createAgent({
          provider: "mock",
          cwd: session.cwd,
          workspaceId: session.workspaceId,
          title: "second tab",
          modeId: "load-test",
          model: "e2e-fast-stream",
        });
        const third = await session.client.createAgent({
          provider: "mock",
          cwd: session.cwd,
          workspaceId: session.workspaceId,
          title: "third tab",
          modeId: "load-test",
          model: "e2e-fast-stream",
        });
        await openAgentRoute(page, session);
        await openAgentRoute(page, { workspaceId: session.workspaceId, agentId: second.id });
        await openAgentRoute(page, { workspaceId: session.workspaceId, agentId: third.id });

        if (viewport.name === "phone width") {
          await page.getByTestId("workspace-tab-switcher-trigger").click();
          await expect(
            page.getByTestId(`workspace-tab-menu-agent_${session.agentId}-trigger`),
          ).toBeVisible();
          await expect(
            page.getByTestId(`workspace-tab-unread-agent_${session.agentId}`),
          ).toHaveCount(0);
          await page.getByRole("button", { name: "Bottom sheet backdrop" }).first().click();
        } else {
          await expect(page.getByTestId(`workspace-tab-agent_${session.agentId}`)).toBeVisible();
          await expect(
            page.getByTestId(`workspace-tab-unread-agent_${session.agentId}`),
          ).toHaveCount(0);
        }

        await session.client.sendAgentMessage(session.agentId, "Report a short result");
        await session.client.waitForFinish(session.agentId);
        const unread = page.getByTestId(`workspace-tab-unread-agent_${session.agentId}`);
        if (viewport.name === "phone width") {
          await page.getByTestId("workspace-tab-switcher-trigger").click();
          await expect(unread).toBeVisible();
          const ids = await page
            .locator('[data-testid^="workspace-tab-menu-agent_"][data-testid$="-trigger"]')
            .evaluateAll((elements) =>
              elements.map((element) => element.getAttribute("data-testid")),
            );
          expect(ids[0]).toBe(`workspace-tab-menu-agent_${session.agentId}-trigger`);
          await page.getByRole("button", { name: /^first-/ }).click();
          // The dot only renders inside the switcher, so look at it there after the visit.
          await page.getByTestId("workspace-tab-switcher-trigger").click();
          await expect(
            page.getByTestId(`workspace-tab-menu-agent_${session.agentId}-trigger`),
          ).toBeVisible();
          if (mode === "explicit read") {
            await expect(unread).toBeVisible();
            await page
              .getByTestId(`workspace-tab-menu-agent_${session.agentId}-mark-as-read`)
              .click();
          }
        } else {
          await expect(unread).toBeVisible();
          const ids = await page
            .locator('[data-testid^="workspace-tab-agent_"]')
            .evaluateAll((elements) =>
              elements.map((element) => element.getAttribute("data-testid")),
            );
          expect(ids[0]).toBe(`workspace-tab-agent_${session.agentId}`);
          await page.getByTestId(`workspace-tab-agent_${session.agentId}`).click();
          if (mode === "explicit read") {
            await expect(unread).toBeVisible();
            await page.getByTestId(`workspace-tab-mark-as-read-agent_${session.agentId}`).click();
          }
        }
        await expect(unread).toHaveCount(0);
      } finally {
        await session.cleanup();
      }
    });
  }

test("background tab activity keeps the tab order by default at desktop", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const session = await seedMockAgentWorkspace({
    repoPrefix: "workspace-tab-stable-order-",
    title: `first-${randomUUID().slice(0, 6)}`,
  });
  try {
    const second = await session.client.createAgent({
      provider: "mock",
      cwd: session.cwd,
      workspaceId: session.workspaceId,
      title: "second tab",
      modeId: "load-test",
      model: "e2e-fast-stream",
    });
    const third = await session.client.createAgent({
      provider: "mock",
      cwd: session.cwd,
      workspaceId: session.workspaceId,
      title: "third tab",
      modeId: "load-test",
      model: "e2e-fast-stream",
    });
    await openAgentRoute(page, session);
    await openAgentRoute(page, { workspaceId: session.workspaceId, agentId: second.id });
    await openAgentRoute(page, { workspaceId: session.workspaceId, agentId: third.id });
    await expect(page.getByTestId(`workspace-tab-agent_${session.agentId}`)).toBeVisible();
    await expect(page.getByTestId(`workspace-tab-agent_${second.id}`)).toBeVisible();
    await expect(page.getByTestId(`workspace-tab-agent_${third.id}`)).toBeVisible();

    const tabIds = () =>
      page
        .locator('[data-testid^="workspace-tab-agent_"]')
        .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-testid")));
    const before = await tabIds();
    // Give a background tab that is not already first its own activity; the default order
    // must not move it to the front. The third tab is focused, so neither candidate is.
    const activeAgentId = [session.agentId, second.id].find(
      (agentId) => before[0] !== `workspace-tab-agent_${agentId}`,
    );
    if (!activeAgentId) throw new Error("expected a background tab that is not first");

    await session.client.sendAgentMessage(activeAgentId, "Report a short result");
    await session.client.waitForFinish(activeAgentId);
    await expect(page.getByTestId(`workspace-tab-unread-agent_${activeAgentId}`)).toBeVisible();
    expect(await tabIds()).toEqual(before);
  } finally {
    await session.cleanup();
  }
});

// Two-level read status: looking at a tab marks it seen (ring), only an explicit read clears it.
test("a looked-at tab is seen, not read, until it is marked read at desktop", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const session = await seedMockAgentWorkspace({
    repoPrefix: "workspace-tab-seen-",
    title: `first-${randomUUID().slice(0, 6)}`,
  });
  try {
    const second = await session.client.createAgent({
      provider: "mock",
      cwd: session.cwd,
      workspaceId: session.workspaceId,
      title: "second tab",
      modeId: "load-test",
      model: "e2e-fast-stream",
    });
    await openAgentRoute(page, session);
    await openAgentRoute(page, { workspaceId: session.workspaceId, agentId: second.id });
    const firstTab = page.getByTestId(`workspace-tab-agent_${session.agentId}`);
    const unread = page.getByTestId(`workspace-tab-unread-agent_${session.agentId}`);
    const seen = page.getByTestId(`workspace-tab-seen-agent_${session.agentId}`);
    await expect(firstTab).toBeVisible();
    await expect(unread).toHaveCount(0);

    // Background activity: new, a filled badge on the tab icon.
    await session.client.sendAgentMessage(session.agentId, "Report a short result");
    await session.client.waitForFinish(session.agentId);
    await expect(unread).toBeVisible();
    await expect(unread).toHaveAttribute("data-read-state", "new");
    await expect(seen).toHaveCount(0);

    // Looking at it (past the dwell) makes it seen: still unread, now a ring.
    await firstTab.click();
    await expect(seen).toBeVisible();
    await expect(unread).toHaveAttribute("data-read-state", "seen");

    // Seen sticks after leaving the tab.
    await page.getByTestId(`workspace-tab-agent_${second.id}`).click();
    await expect(seen).toBeVisible();

    // New activity after the look turns it back into new.
    await session.client.sendAgentMessage(session.agentId, "Report another short result");
    await session.client.waitForFinish(session.agentId);
    await expect(seen).toHaveCount(0);
    await expect(unread).toHaveAttribute("data-read-state", "new");

    // Only the explicit read clears the badge.
    await firstTab.hover();
    await page.getByTestId(`workspace-tab-mark-as-read-agent_${session.agentId}`).click();
    await expect(unread).toHaveCount(0);
    await expect(seen).toHaveCount(0);
  } finally {
    await session.cleanup();
  }
});

// The read check and clipping cue share overlay space; neither changes the chip's width.
test("compact titles and read controls keep tab geometry stable through hover and keyboard focus", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1400, height: 900 });
  const title =
    "A very long session title that must be clipped without reserving room for truncation dots or read controls";
  const session = await seedMockAgentWorkspace({ repoPrefix: "tab-density-", title });
  try {
    const second = await session.client.createAgent({
      provider: "mock",
      cwd: session.cwd,
      workspaceId: session.workspaceId,
      title: "Short title",
      modeId: "load-test",
      model: "e2e-fast-stream",
    });
    const medium = await session.client.createAgent({
      provider: "mock",
      cwd: session.cwd,
      workspaceId: session.workspaceId,
      title: "Medium title",
      modeId: "load-test",
      model: "e2e-fast-stream",
    });
    await openAgentRoute(page, session);
    const first = page.getByTestId(`workspace-tab-agent_${session.agentId}`).first();
    await expect(first).toBeVisible();
    await expect(first).toHaveAccessibleName(new RegExp("A very long session title"));
    await expect(first.getByTestId("workspace-tab-title-compact")).toBeVisible();
    await expect(first.getByTestId("workspace-tab-title-text")).toHaveCSS("text-overflow", "clip");
    await expect(first.getByTestId("workspace-tab-title-fade")).toBeVisible();
    for (const id of [second.id, medium.id]) {
      const fitting = page.getByTestId(`workspace-tab-agent_${id}`).first();
      await expect(fitting).toBeVisible();
      const text = fitting.getByTestId("workspace-tab-title-text");
      await expect(text).toHaveCSS("text-overflow", "clip");
      expect(await text.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      await expect(fitting.getByTestId("workspace-tab-title-fade")).toHaveCount(0);
    }
    await page.mouse.move(600, 600);
    await page.screenshot({ path: testInfo.outputPath("titles-normal-long.png") });
    const before = await first.boundingBox();
    await openAgentRoute(page, { workspaceId: session.workspaceId, agentId: second.id });
    await session.client.sendAgentMessage(session.agentId, "Report a short result");
    await session.client.waitForFinish(session.agentId);
    const read = page.getByTestId(`workspace-tab-mark-as-read-agent_${session.agentId}`);
    const close = page.getByTestId(`workspace-agent-close-${session.agentId}`);
    await expect(page.getByTestId(`workspace-tab-unread-agent_${session.agentId}`)).toBeVisible();
    await first.click();
    await page.getByRole("textbox", { name: "Message agent..." }).click();
    await page.mouse.move(600, 600);
    await expect(read).toHaveCount(0);
    expect((await first.boundingBox())?.width).toBe(before?.width);
    await page.screenshot({ path: testInfo.outputPath("titles-unread-active.png") });
    await first.hover();
    await expect(read).toBeVisible();
    const closeBefore = await close.boundingBox();
    expect((await first.boundingBox())?.width).toBe(before?.width);
    await page.screenshot({ path: testInfo.outputPath("titles-hovered.png") });
    await page.mouse.move(600, 600);
    await first.focus();
    await page.keyboard.press("Tab");
    // Keyboard focus may land on a trailing action; focus-within keeps its neighbors visible.
    await expect(read).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("titles-keyboard-focused.png") });
    await read.click();
    await expect(read).toHaveCount(0);
    await first.hover();
    expect(await close.boundingBox()).toEqual(closeBefore);
    await page.setViewportSize({ width: 720, height: 700 });
    await page.mouse.move(600, 600);
    await page.screenshot({ path: testInfo.outputPath("titles-narrow.png") });
    // The preference uses the ordinary settings persistence, and survives a reload.
    await page.evaluate(() => {
      const key = "@paseo:app-settings";
      localStorage.setItem(
        key,
        JSON.stringify({
          ...JSON.parse(localStorage.getItem(key) || "{}"),
          compactTabTitles: false,
        }),
      );
    });
    await page.reload();
    await expect(first.getByTestId("workspace-tab-title-ellipsis")).toBeVisible();
    await expect(first.getByTestId("workspace-tab-title-text")).toHaveCSS(
      "text-overflow",
      "ellipsis",
    );
    await page.screenshot({ path: testInfo.outputPath("titles-regular-ellipsis.png") });
  } finally {
    await session.cleanup();
  }
});
