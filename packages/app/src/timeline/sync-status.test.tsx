/* eslint-disable react-perf/jsx-no-new-object-as-prop, react-perf/jsx-no-new-function-as-prop -- tests deliberately replace props and control handlers */
/** @vitest-environment jsdom */
import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { ToastState } from "@/components/toast-host";
import { TimelineSyncStatus } from "./sync-status";

vi.mock("@/constants/layout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/constants/layout")>()),
  useIsCompactFormFactor: () => false,
}));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string) =>
      key.endsWith("reconnecting") ? "Reconnecting to host" : "Updating messages",
  }),
}));
vi.mock("react-native-reanimated", async () => {
  const { View } = await import("react-native");
  return {
    default: { View },
    FadeIn: { duration: () => undefined },
    FadeOut: { duration: () => undefined },
  };
});

beforeEach(() => vi.stubGlobal("React", React));

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  vi.useRealTimers();
});

it("keeps one alert above the composer as user errors override sync and expire", () => {
  vi.useFakeTimers();
  const onDismiss = vi.fn();
  const error: ToastState = {
    id: 1,
    content: "Fork failed",
    nativeMessage: "Fork failed",
    variant: "error",
    durationMs: 3200,
  };
  const view = render(
    <TimelineSyncStatus sync={{ status: "reconnecting" }} toast={null} onDismiss={onDismiss} />,
  );
  const alert = view.getByRole("alert");
  const rail = alert.parentElement!.parentElement!;
  expect(getComputedStyle(rail).bottom).toBe("8px");
  expect(getComputedStyle(alert).pointerEvents).toBe("none");
  expect(view.getByTestId("app-toast-message").textContent).toBe("Reconnecting to host");

  view.rerender(
    <TimelineSyncStatus sync={{ status: "reconnecting" }} toast={error} onDismiss={onDismiss} />,
  );
  expect(view.getByRole("alert")).toBe(alert);
  expect(view.queryByTestId("agent-reconnecting-toast")).toBeNull();
  expect(view.getByTestId("app-toast-message").textContent).toBe("Fork failed");
  expect(getComputedStyle(alert).pointerEvents).toBe("auto");
  act(() => vi.advanceTimersByTime(3200));
  expect(onDismiss).toHaveBeenCalledTimes(1);

  view.rerender(
    <TimelineSyncStatus sync={{ status: "reconnecting" }} toast={null} onDismiss={onDismiss} />,
  );
  expect(view.getByRole("alert")).toBe(alert);
  expect(view.getByTestId("app-toast-message").textContent).toBe("Reconnecting to host");
  expect(getComputedStyle(alert).pointerEvents).toBe("none");
  view.rerender(
    <TimelineSyncStatus
      sync={{ status: "catching_up", ui: "status" }}
      toast={null}
      onDismiss={onDismiss}
    />,
  );
  expect(view.getByRole("alert")).toBe(alert);
  expect(view.getByTestId("app-toast-message").textContent).toBe("Updating messages");
  act(() => vi.advanceTimersByTime(60_000));
  expect(onDismiss).toHaveBeenCalledTimes(1);
  view.rerender(
    <TimelineSyncStatus sync={{ status: "idle" }} toast={null} onDismiss={onDismiss} />,
  );
  expect(view.queryByRole("alert")).toBeNull();
});

it("keeps a user toast action interactive during reconnect and dismisses before its action", () => {
  const order: string[] = [];
  const toast: ToastState = {
    id: 1,
    content: "Pane restored",
    nativeMessage: "Pane restored",
    variant: "default",
    durationMs: null,
    action: { label: "Undo", onPress: () => order.push("action") },
  };
  const view = render(
    <TimelineSyncStatus
      sync={{ status: "reconnecting" }}
      toast={toast}
      onDismiss={() => order.push("dismiss")}
    />,
  );
  fireEvent.click(view.getByRole("button", { name: "Undo" }));
  expect(order).toEqual(["dismiss", "action"]);
  expect(view.getAllByRole("alert")).toHaveLength(1);
});
