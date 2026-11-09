import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { i18n } from "@/i18n/i18next";
import { AgentLimitHandoff } from "./agent-limit-handoff";
void i18n;

const state = vi.hoisted(() => ({ fork: vi.fn() }));
vi.mock("@/hooks/use-fork-agent", () => ({ useForkAgent: () => state.fork }));
vi.mock("@/runtime/host-features", () => ({ useHostFeature: () => true }));
vi.mock("@/runtime/host-runtime", () => ({ useHostRuntimeIsConnected: () => true }));
vi.mock("@/panels/pane-context", () => ({
  usePaneContext: () => ({ layoutWorkspaceId: "fixture" }),
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
vi.mock("@/hooks/use-providers-snapshot", () => ({
  useProvidersSnapshot: () => ({
    isLoading: false,
    error: null,
    refetchIfStale: vi.fn(),
    entries: [
      {
        provider: "codex",
        enabled: true,
        status: "ready",
        label: "Backup provider",
        models: [{ id: "backup", label: "Backup model" }],
      },
    ],
  }),
}));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("React", React);
  state.fork.mockReset().mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

test("the real handoff controls fit desktop and phone widths and prepare the chosen agent", async () => {
  await page.viewport(900, 700);
  act(() =>
    root.render(
      React.createElement(AgentLimitHandoff, {
        serverId: "fixture",
        workspaceId: "workspace",
        agentId: "source",
        agent: {
          id: "source",
          serverId: "fixture",
          provider: "claude",
          cwd: "/fixture",
          status: "idle",
        },
        entries: [
          {
            id: "limit",
            kind: "outcome",
            status: "completed",
            timestamp: "2026-11-09T21:28:33Z",
            text: "You've hit your weekly limit · resets Nov 12 at 4am (America/Denver)",
            truncated: false,
          },
        ],
        toast: { error: vi.fn(), show: vi.fn(), copied: vi.fn() },
      }),
    ),
  );
  await expect.element(page.getByRole("alert")).toBeVisible();
  const prepare = page.getByRole("button", { name: "Prepare handoff", exact: true });
  await expect.element(prepare).toBeDisabled();
  await page.getByTestId("combined-model-selector").click();
  await page.getByText("Backup model", { exact: true }).click();
  await expect.element(prepare).toBeEnabled();
  await page.screenshot({
    element: container,
    path: "../../.vitest-screenshots/limit-handoff-desktop.png",
  });
  await page.viewport(390, 800);
  await expect.element(prepare).toBeVisible();
  expect(container.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  await page.screenshot({
    element: container,
    path: "../../.vitest-screenshots/limit-handoff-phone.png",
  });
  await prepare.click();
  await expect.poll(() => state.fork.mock.calls.length).toBe(1);
  expect(state.fork).toHaveBeenCalledWith(
    expect.objectContaining({ handoff: { provider: "codex", modelId: "backup" }, target: "split" }),
  );
});
