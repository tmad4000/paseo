import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { NavigationBackButton, NavigationForwardButton } from "./navigation-back-button";
import { i18n } from "@/i18n/i18next";
void i18n;
const fixture = vi.hoisted(() => ({ navigate: vi.fn(), compact: false }));
vi.mock("@/navigation/focus-history-runtime", () => ({
  useCanNavigateBackInFocusHistory: () => true,
  useCanNavigateForwardInFocusHistory: () => true,
  useFocusHistoryEntries: () =>
    Array.from({ length: 20 }, (_, i) => ({ kind: "route", pathname: `/visit-${i}` })),
  navigateInFocusHistory: fixture.navigate,
}));
vi.mock("@/constants/layout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/constants/layout")>()),
  useIsCompactFormFactor: () => fixture.compact,
}));
vi.mock("@/hooks/use-shortcut-keys", () => ({ useShortcutKeys: () => null }));
vi.mock("expo-router", () => ({
  router: {},
  useRouter: () => ({}),
  useLocalSearchParams: () => ({}),
  usePathname: () => "/fixture",
}));
// Keep the real menu, browser layout, pointer events and keyboard handling; the harness has no native animation runtime.
vi.mock("react-native-reanimated", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native-reanimated")>();
  const { View } = await import("react-native");
  const animation = { duration: () => animation };
  class Keyframe {
    duration() {
      return this;
    }
  }
  return {
    ...actual,
    default: { ...actual.default, View },
    Keyframe,
    FadeIn: animation,
    FadeOut: animation,
  };
});
let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fixture.navigate.mockReset();
  fixture.compact = false;
  container = document.createElement("div");
  container.style.cssText = "padding:40px;display:flex;width:500px";
  // The test theme adapter does not resolve Unistyles breakpoints; supply only the header hitboxes.
  const geometry = document.createElement("style");
  geometry.textContent = `[data-testid="navigation-back-button"], [data-testid="navigation-forward-button"], [data-testid="navigation-back-button-history-menu-button"], [data-testid="navigation-forward-button-history-menu-button"] { width:32px !important; height:32px !important; }`;
  document.head.append(geometry);
  geometry.id = "history-test-geometry";
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <>
        <input aria-label="Draft" />
        <NavigationBackButton />
        <NavigationForwardButton />
      </>,
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.getElementById("history-test-geometry")?.remove();
  vi.unstubAllGlobals();
});

test("hover reaches every history row, keeps draft focus and leaves one-step arrow clickable", async () => {
  await page.getByRole("textbox", { name: "Draft" }).click();
  await page.getByTestId("navigation-back-button").hover();
  await expect.element(page.getByTestId("navigation-back-button-history")).toBeVisible();
  await expect.element(page.getByRole("textbox", { name: "Draft" })).toHaveFocus();
  await page.getByTestId("navigation-back-history-item-0").hover();
  await page.getByTestId("navigation-back-history-item-16").hover();
  await page.getByTestId("navigation-back-history-item-16").click();
  expect(fixture.navigate).toHaveBeenLastCalledWith("back", { isCompact: false, steps: 17 });
  await page.getByTestId("navigation-forward-button").hover();
  await expect.element(page.getByTestId("navigation-forward-button-history")).toBeVisible();
  await page.getByTestId("navigation-forward-history-item-0").hover();
  await expect.element(page.getByTestId("navigation-forward-button-history")).toBeVisible();
  await page.getByTestId("navigation-forward-button").click();
  expect(fixture.navigate).toHaveBeenLastCalledWith("forward", { isCompact: false });
  await expect
    .element(page.getByTestId("navigation-forward-button-history"))
    .not.toBeInTheDocument();
});

test("leaving hover closes preview and keyboard opening still supports Escape", async () => {
  await page.getByTestId("navigation-back-button").hover();
  await expect.element(page.getByTestId("navigation-back-button-history")).toBeVisible();
  await page.getByRole("textbox", { name: "Draft" }).hover();
  await expect.element(page.getByTestId("navigation-back-button-history")).not.toBeInTheDocument();
  await page.getByTestId("navigation-back-button-history-menu-button").click();
  await expect.element(page.getByTestId("navigation-back-button-history")).toBeVisible();
  await page.getByTestId("navigation-back-history-item-0").hover();
  await expect.element(page.getByTestId("navigation-back-button-history")).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(page.getByTestId("navigation-back-button-history")).not.toBeInTheDocument();
});

test("compact touch-sized layouts keep history explicit and do not open from mouse movement", async () => {
  fixture.compact = true;
  await act(async () =>
    root.render(
      <>
        <input aria-label="Draft" />
        <NavigationBackButton />
        <NavigationForwardButton />
      </>,
    ),
  );
  await page.getByTestId("navigation-back-button").hover();
  await new Promise((resolve) => setTimeout(resolve, 450));
  expect(document.querySelector('[data-testid="navigation-back-button-history"]')).toBeNull();
  await page.getByTestId("navigation-back-button").click();
  expect(fixture.navigate).toHaveBeenLastCalledWith("back", { isCompact: true });
  await page.getByTestId("navigation-back-button-history-menu-button").click();
  await expect.element(page.getByTestId("navigation-back-history-item-0")).toBeVisible();
});

test("an arrow click cancels a pending preview", async () => {
  await page.getByTestId("navigation-back-button").hover();
  await page.getByTestId("navigation-back-button").click();
  expect(fixture.navigate).toHaveBeenLastCalledWith("back", { isCompact: false });
  await new Promise((resolve) => setTimeout(resolve, 450));
  expect(document.querySelector('[data-testid="navigation-back-button-history"]')).toBeNull();
});

test("a chevron click cancels a pending preview and keeps the menu focused", async () => {
  await page.getByTestId("navigation-back-button-history-menu-button").hover();
  await page.getByTestId("navigation-back-button-history-menu-button").click();
  await expect.element(page.getByTestId("navigation-back-history-item-0")).toHaveFocus();
  await new Promise((resolve) => setTimeout(resolve, 450));
  await expect.element(page.getByTestId("navigation-back-history-item-0")).toHaveFocus();
  await page.getByTestId("navigation-back-button-history-backdrop").click({ position: { x: 5, y: 5 } });
  await expect.element(page.getByTestId("navigation-back-button-history")).not.toBeInTheDocument();
});

test("activating the chevron promotes a hover preview to a keyboard menu", async () => {
  await page.getByRole("textbox", { name: "Draft" }).click();
  await page.getByTestId("navigation-back-button-history-menu-button").hover();
  await expect.element(page.getByTestId("navigation-back-button-history")).toBeVisible();
  await expect.element(page.getByRole("textbox", { name: "Draft" })).toHaveFocus();
  await page.getByTestId("navigation-back-button-history-menu-button").click();
  await expect.element(page.getByTestId("navigation-back-history-item-0")).toHaveFocus();
  await userEvent.keyboard("{ArrowDown}");
  await expect.element(page.getByTestId("navigation-back-history-item-1")).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  expect(fixture.navigate).toHaveBeenLastCalledWith("back", { isCompact: false, steps: 2 });
});

test("keyboard activation promotes a preview", async () => {
  await page.getByTestId("navigation-back-button-history-menu-button").hover();
  await expect.element(page.getByTestId("navigation-back-button-history")).toBeVisible();
  (document.querySelector('[data-testid="navigation-back-button-history-menu-button"]') as HTMLElement).focus();
  await userEvent.keyboard("{Enter}");
  await expect.element(page.getByTestId("navigation-back-history-item-0")).toHaveFocus();
});
