import { setResponseMonitoringActive } from "@/performance/response-monitor";
import { responsivenessMetrics } from "@/performance/responsiveness";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Pressable, Text } from "react-native";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { IconTooltip } from "./icon-tooltip";

// The browser harness has no native animation runtime; keep tooltip rendering and events real.
vi.mock("react-native-reanimated", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native-reanimated")>();
  const { View } = await import("react-native");
  const animation = { duration: () => animation };
  return { ...actual, default: { ...actual.default, View }, FadeIn: animation, FadeOut: animation };
});

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  container.style.cssText = "width:320px;padding:48px;font:14px sans-serif";
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  setResponseMonitoringActive(false);
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function noop() {}

function IconButton({ onPress, testID }: { onPress: () => void; testID: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Copy"
      onPress={onPress}
      testID={testID}
    >
      <Text>⧉</Text>
    </Pressable>
  );
}

test("names an icon-only control on hover and keeps it pressable, wrapped or not", async () => {
  const onWrapped = vi.fn();
  const onDirect = vi.fn();
  await act(async () =>
    root.render(
      <>
        <IconTooltip label="Copy message">
          <IconButton onPress={onWrapped} testID="wrapped" />
        </IconTooltip>
        <IconTooltip label="Copy code" wrap={false}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Copy"
            onPress={onDirect}
            testID="direct"
          >
            <Text>⧉</Text>
          </Pressable>
        </IconTooltip>
      </>,
    ),
  );

  await page.getByTestId("wrapped").hover();
  await expect.element(page.getByText("Copy message", { exact: true })).toBeVisible();
  await page.getByTestId("wrapped").click();
  expect(onWrapped).toHaveBeenCalledTimes(1);

  await page.getByTestId("direct").hover();
  await expect.element(page.getByText("Copy code", { exact: true })).toBeVisible();
  await page.getByTestId("direct").click();
  expect(onDirect).toHaveBeenCalledTimes(1);
});

test("renders the bare control when there is no label or the tooltip is disabled", async () => {
  await act(async () =>
    root.render(
      <>
        <IconTooltip label={null}>
          <IconButton onPress={noop} testID="unlabeled" />
        </IconTooltip>
        <IconTooltip label="Workspace actions" disabled>
          <IconButton onPress={noop} testID="menu-open" />
        </IconTooltip>
      </>,
    ),
  );
  await page.getByTestId("menu-open").hover();
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect(document.body.textContent).not.toContain("Workspace actions");
});

test("a press that disables the tooltip mid-delay does not leave it to reappear later", async () => {
  const render = (disabled: boolean) =>
    root.render(
      <IconTooltip label="Workspace actions" disabled={disabled}>
        <IconButton onPress={noop} testID="kebab" />
      </IconTooltip>,
    );
  await act(async () => render(false));
  await page.getByTestId("kebab").hover();
  // The menu opens before the 300ms hover delay elapses, disabling the tooltip.
  await act(async () => render(true));
  await new Promise((resolve) => setTimeout(resolve, 500));
  // The menu closes while the pointer is still over the trigger.
  await act(async () => render(false));
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(document.body.textContent).not.toContain("Workspace actions");
});

function measuredWork() {
  const started = performance.now();
  let iterations = 0;
  do {
    iterations++;
  } while (performance.now() - started < 25);
  return iterations;
}

test("times the action inside the standard hover wrapper, including its synchronous work", async () => {
  const onPress = vi.fn(measuredWork);
  const before =
    responsivenessMetrics.snapshot().find((row) => row.metric === "tooltip.handler")?.count ?? 0;
  await act(async () =>
    root.render(
      <IconTooltip label="Back">
        <IconButton onPress={onPress} testID="timed-back" />
      </IconTooltip>,
    ),
  );
  setResponseMonitoringActive(true);
  await page.getByTestId("timed-back").click();
  expect(onPress).toHaveBeenCalledTimes(1);
  const sample = responsivenessMetrics.snapshot().find((row) => row.metric === "tooltip.handler");
  expect(sample?.count).toBe(before + 1);
  expect(sample?.max).toBeGreaterThanOrEqual(20);
});
