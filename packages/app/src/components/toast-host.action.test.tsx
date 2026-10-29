/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useToastHost } from "./toast-host";

describe("toast actions", () => {
  it("keeps the action and stays up long enough to reach it", () => {
    const onPress = vi.fn();
    const { result } = renderHook(() => useToastHost());
    act(() => result.current.api.show("Pane restored", { action: { label: "Undo", onPress } }));
    expect(result.current.toast?.action?.label).toBe("Undo");
    expect(result.current.toast?.durationMs).toBe(5000);
    act(() => result.current.api.show("Copied"));
    expect(result.current.toast?.action).toBeUndefined();
    expect(result.current.toast?.durationMs).toBe(2200);
  });

  it("honours an explicit duration even with an action", () => {
    const { result } = renderHook(() => useToastHost());
    act(() =>
      result.current.api.show("Pinned", {
        durationMs: null,
        action: { label: "Open", onPress: () => {} },
      }),
    );
    expect(result.current.toast?.durationMs).toBeNull();
  });
});
