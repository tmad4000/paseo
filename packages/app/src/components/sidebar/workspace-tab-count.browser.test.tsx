import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { WorkspaceTabCount } from "./workspace-tab-count";
import { useWorkspaceLayoutStore, findPaneContainingTab } from "@/stores/workspace-layout-store";
import { i18n } from "@/i18n/i18next";
void i18n;
vi.mock("react-native-svg", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-native-svg")>()),
  // @ts-expect-error The SVG package ships this web JS entry without a declaration.
  ...(await import("react-native-svg/lib/module/elements.web.js")),
}));
vi.mock("lucide-react-native", async (importOriginal) => ({
  ...(await importOriginal<typeof import("lucide-react-native")>()),
  // @ts-expect-error Use the real icon's web renderer instead of the harness's empty icon stub.
  Copy: (await import("lucide-react-native/dist/esm/icons/copy.js")).default,
}));
vi.mock("expo-router", () => ({
  router: {},
  useRouter: () => ({}),
  useLocalSearchParams: () => ({}),
  usePathname: () => "/fixture",
}));

// The browser harness has no native animation runtime; keep tooltip rendering and events real.
vi.mock("react-native-reanimated", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native-reanimated")>();
  const { View } = await import("react-native");
  const animation = { duration: () => animation };
  return { ...actual, default: { ...actual.default, View }, FadeIn: animation, FadeOut: animation };
});

const workspaceKey = "tab-count-host:workspace";
let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await useWorkspaceLayoutStore.persist.rehydrate();
  useWorkspaceLayoutStore.setState({ layoutByWorkspace: {} });
  container = document.createElement("div");
  container.style.cssText =
    "width:280px;padding:12px;background:#fafafa;color:#111;font:14px sans-serif";
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<WorkspaceTabCount workspaceKey={workspaceKey} />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  useWorkspaceLayoutStore.setState({ layoutByWorkspace: {} });
});

async function openAgent(agentId: string, key = workspaceKey) {
  let tabId: string | null = null;
  await act(async () => {
    tabId = useWorkspaceLayoutStore.getState().openTab({
      workspaceKey: key,
      intent: "reveal",
      target: { kind: "agent", agentId },
    });
  });
  return tabId!;
}

test("shows and updates the multi-tab indicator without counting another workspace", async () => {
  expect(container.textContent).toBe("");
  await openAgent("first");
  await expect.element(page.getByLabelText("1 open tab")).toBeVisible();
  await openAgent("other", "tab-count-host:other");
  await expect.element(page.getByLabelText("1 open tab")).toBeVisible();
  const second = await openAgent("second");
  await expect.element(page.getByLabelText("2 open tabs")).toBeVisible();
  expect(container.querySelector('[data-testid="sidebar-workspace-tab-count"]')?.textContent).toBe(
    "2",
  );
  await openAgent("third");
  await expect.element(page.getByLabelText("3 open tabs")).toBeVisible();
  await page.getByLabelText("3 open tabs").hover();
  await expect.element(page.getByText("3 open tabs", { exact: true })).toBeVisible();
  expect(container.querySelector("svg rect")).not.toBeNull();
  await page.screenshot({ path: "sidebar-tab-count.png" });
  await act(async () => useWorkspaceLayoutStore.getState().closeTab(workspaceKey, second));
  await expect.element(page.getByLabelText("2 open tabs")).toBeVisible();
});

test("shows one tab when only one remains and excludes new-tab placeholders", async () => {
  await openAgent("first");
  let placeholder: string | null = null;
  await act(async () => {
    placeholder = useWorkspaceLayoutStore
      .getState()
      .openTab({ workspaceKey, intent: "new", target: { kind: "new_tab" } });
  });
  expect(placeholder).not.toBeNull();
  await expect.element(page.getByLabelText("1 open tab")).toBeVisible();
  const second = await openAgent("second");
  await expect.element(page.getByLabelText("2 open tabs")).toBeVisible();
  await act(async () => useWorkspaceLayoutStore.getState().closeTab(workspaceKey, second));
  await expect.element(page.getByLabelText("1 open tab")).toBeVisible();
});

test("counts split tabs and excludes the hidden Explorer pane", async () => {
  const first = await openAgent("first");
  const second = await openAgent("second");
  await act(async () => {
    const store = useWorkspaceLayoutStore.getState();
    const pane = findPaneContainingTab(store.layoutByWorkspace[workspaceKey]!.root, first)!;
    store.splitPane(workspaceKey, { tabId: second, targetPaneId: pane.id, position: "right" });
  });
  await expect.element(page.getByLabelText("2 open tabs")).toBeVisible();
  await act(async () => {
    const store = useWorkspaceLayoutStore.getState();
    const paneId = store.showExplorerSidebar(workspaceKey)!;
    store.openTab({
      workspaceKey,
      intent: "reveal",
      target: { kind: "terminal", terminalId: "terminal" },
      placement: { mode: "pane", paneId },
    });
  });
  // Opening Explorer also opens its Files and Changes tabs.
  await expect.element(page.getByLabelText("5 open tabs")).toBeVisible();
  await act(async () => useWorkspaceLayoutStore.getState().hideExplorerSidebar(workspaceKey));
  await expect.element(page.getByLabelText("2 open tabs")).toBeVisible();
});
