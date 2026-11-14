import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { Pressable, Text } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Tooltip, TooltipTrigger } from "./tooltip";

vi.mock("@/constants/platform", () => ({
  isWeb: true,
  isNative: false,
}));

vi.mock("@/constants/layout", () => ({
  useIsCompactFormFactor: () => false,
}));

vi.mock("@gorhom/portal", () => ({
  Portal: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@gorhom/bottom-sheet", () => ({
  useBottomSheetModalInternal: () => null,
}));

vi.mock("react-native-reanimated", () => ({
  default: {
    View: "div",
  },
  FadeIn: {},
  FadeOut: {},
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (styles: unknown) => styles,
  },
}));

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("Node", dom.window.Node);
  vi.stubGlobal("navigator", dom.window.navigator);

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

function renderTrigger({
  childDisabled,
  onPress,
}: {
  childDisabled: boolean;
  onPress: () => void;
}): void {
  act(() => {
    root?.render(
      <Tooltip>
        <TooltipTrigger asChild>
          <Pressable disabled={childDisabled} onPress={onPress} testID="trigger">
            <Text>Send</Text>
          </Pressable>
        </TooltipTrigger>
      </Tooltip>,
    );
  });
}

function pressTrigger(): void {
  const trigger = container?.querySelector('[data-testid="trigger"]');
  expect(trigger).not.toBeNull();

  act(() => {
    trigger?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
}

describe("TooltipTrigger", () => {
  it("keeps an asChild trigger disabled when the child is disabled", () => {
    const onPress = vi.fn();

    renderTrigger({ childDisabled: true, onPress });
    pressTrigger();

    expect(onPress).not.toHaveBeenCalled();
  });

  it("keeps an asChild trigger interactive when the child is not disabled", () => {
    const onPress = vi.fn();

    renderTrigger({ childDisabled: false, onPress });
    pressTrigger();

    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe("TooltipTrigger response telemetry", () => {
  it.each([false, true])("measures one complete press with asChild=%s", async (asChild) => {
    const { setResponseMonitoringActive } = await import("@/performance/response-monitor");
    const { responsivenessMetrics } = await import("@/performance/responsiveness");
    let now = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const record = vi.spyOn(responsivenessMetrics, "record");
    const calls: string[] = [];
    let childEvent: unknown;
    const onChildPress = (event: import("react-native").GestureResponderEvent) => {
      calls.push("child");
      childEvent = event;
      event.preventDefault();
      now += 17;
    };
    const onTriggerPress = (event: import("react-native").GestureResponderEvent) => {
      calls.push("trigger");
      if (asChild) {
        expect(event).toBe(childEvent);
        expect(event.isDefaultPrevented()).toBe(true);
      }
      now += 3;
    };
    try {
      act(() => root?.render(
        <Tooltip>
          <TooltipTrigger asChild={asChild} onPress={onTriggerPress} testID={asChild ? undefined : "trigger"}>
            {asChild ? <Pressable onPress={onChildPress} testID="trigger"><Text>Action</Text></Pressable> : <Text>Action</Text>}
          </TooltipTrigger>
        </Tooltip>,
      ));
      setResponseMonitoringActive(true);
      pressTrigger();
      expect(calls).toEqual(asChild ? ["child", "trigger"] : ["trigger"]);
      expect(record.mock.calls).toEqual([["tooltip.handler", asChild ? 20 : 3]]);
      expect(frames).toHaveLength(1);
      now = 32;
      frames[0](now);
      expect(record.mock.calls).toEqual([
        ["tooltip.handler", asChild ? 20 : 3],
        ["tooltip.frame", 32],
      ]);
    } finally {
      setResponseMonitoringActive(false);
      clock.mockRestore();
      record.mockRestore();
    }
  });
});

it("measures an asChild-only action and leaves a disabled child unsampled", async () => {
  const { setResponseMonitoringActive } = await import("@/performance/response-monitor");
  const { responsivenessMetrics } = await import("@/performance/responsiveness");
  let now = 0;
  const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
  const record = vi.spyOn(responsivenessMetrics, "record");
  const frame = vi.fn(() => 1);
  vi.stubGlobal("requestAnimationFrame", frame);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const onPress = vi.fn(() => { now += 25; });
  try {
    renderTrigger({ childDisabled: true, onPress });
    setResponseMonitoringActive(true);
    pressTrigger();
    expect(record).not.toHaveBeenCalled();
    expect(frame).not.toHaveBeenCalled();
    renderTrigger({ childDisabled: false, onPress });
    pressTrigger();
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(record.mock.calls).toEqual([["tooltip.handler", 25]]);
    expect(frame).toHaveBeenCalledTimes(1);
  } finally {
    setResponseMonitoringActive(false);
    clock.mockRestore();
    record.mockRestore();
  }
});
