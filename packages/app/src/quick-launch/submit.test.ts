/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useQuickLaunchSubmit, type QuickLaunchKeyPressEvent } from "./submit";

function keyPress(input: { shiftKey?: boolean }): QuickLaunchKeyPressEvent {
  return {
    nativeEvent: { key: "Enter", metaKey: true, ctrlKey: false, shiftKey: input.shiftKey ?? false },
    preventDefault: () => undefined,
  } as QuickLaunchKeyPressEvent;
}

function renderSubmit(input: { visible: boolean; accepts: boolean[] }) {
  const calls: boolean[] = [];
  const accepts = [...input.accepts];
  const hook = renderHook(
    ({ visible }) =>
      useQuickLaunchSubmit({
        visible,
        submit: (openAfterStart) => {
          calls.push(openAfterStart);
          return accepts.shift() ?? true;
        },
      }),
    { initialProps: { visible: input.visible } },
  );
  return { hook, calls };
}

describe("useQuickLaunchSubmit", () => {
  it("starts once when Mod+Enter fires twice", () => {
    const { hook, calls } = renderSubmit({ visible: true, accepts: [] });

    act(() => {
      hook.result.current.handleKeyPress(keyPress({}));
      hook.result.current.handleKeyPress(keyPress({}));
    });

    expect(calls).toEqual([false]);
  });

  it("ignores Mod+Shift+Enter and button presses after a start", () => {
    const { hook, calls } = renderSubmit({ visible: true, accepts: [] });

    act(() => {
      hook.result.current.handleKeyPress(keyPress({ shiftKey: true }));
      hook.result.current.handleKeyPress(keyPress({}));
      hook.result.current.start(false);
    });

    expect(calls).toEqual([true]);
  });

  it("does not start while the dialog is closing", () => {
    const { hook, calls } = renderSubmit({ visible: true, accepts: [] });

    hook.rerender({ visible: false });
    act(() => {
      hook.result.current.handleKeyPress(keyPress({}));
    });

    expect(calls).toEqual([]);
  });

  it("lets a refused start be retried", () => {
    const { hook, calls } = renderSubmit({ visible: true, accepts: [false, true, true] });

    act(() => {
      hook.result.current.start(false);
      hook.result.current.start(false);
      hook.result.current.start(false);
    });

    expect(calls).toEqual([false, false]);
  });
});
