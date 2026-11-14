// @vitest-environment jsdom
import React, { useRef } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { View } from "react-native";
import { Combobox } from "./combobox";
import { i18n } from "@/i18n/i18next";
void i18n;
const fixture = vi.hoisted(() => ({ compact: false }));

vi.mock("@/constants/layout", async (original) => ({
  ...(await original<typeof import("@/constants/layout")>()),
  useIsCompactFormFactor: () => fixture.compact,
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock("@floating-ui/react-native", () => {
  const refs = { setFloating: () => {}, setOffsetParent: () => {} };
  const update = async () => {};
  const floatingStyles = { top: 0, left: 0 };
  return {
    useFloating: () => ({ refs, update, floatingStyles }),
    offset: () => ({}),
    shift: () => ({}),
    size: () => ({}),
    flip: () => ({}),
  };
});
vi.mock("@gorhom/bottom-sheet", async () => {
  const { View: NativeView, ScrollView } = await import("react-native");
  const { forwardRef, useImperativeHandle } = await import("react");
  const Sheet = forwardRef(function Sheet({ children }: { children?: React.ReactNode }, ref) {
    useImperativeHandle(ref, () => ({ present() {}, dismiss() {} }));
    return <NativeView>{children}</NativeView>;
  });
  return {
    BottomSheetModal: Sheet,
    BottomSheetBackdrop: NativeView,
    BottomSheetScrollView: ScrollView,
  };
});
vi.mock("react-native-reanimated", async () => {
  const { View: NativeView } = await import("react-native");
  const animation = { duration: () => animation };
  return {
    default: { View: NativeView },
    FadeIn: animation,
    FadeOut: animation,
    useAnimatedStyle: (factory: () => unknown) => factory(),
  };
});
vi.mock("react-native-gesture-handler", async () => ({
  GestureHandlerRootView: (await import("react-native")).View,
}));
vi.mock("@/hooks/use-keyboard-visibility", () => ({ useKeyboardVisibility: () => false }));

beforeEach(() => {
  fixture.compact = false;
  vi.stubGlobal("React", React);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const options = [
  { id: "first", label: "First result" },
  { id: "second", label: "Second result" },
];
function Picker({ onSelect }: { onSelect: (id: string) => void }) {
  const anchor = useRef<View>(null);
  return (
    <>
      <View ref={anchor} />
      <Combobox
        open
        value="first"
        options={options}
        onSelect={onSelect}
        anchorRef={anchor}
        searchPlaceholder="Search results"
        preserveActiveOption
      />
    </>
  );
}

it.each([false, true])(
  "lets a focused result own Enter instead of selecting another highlighted result (compact=%s)",
  async (compact) => {
    fixture.compact = compact;
    const onSelect = vi.fn();
    render(<Picker onSelect={onSelect} />);
    const input = await screen.findByRole("combobox", { name: "Search results" });
    await waitFor(() => expect(input.getAttribute("aria-activedescendant")).toContain("first"));
    const second = screen.getByRole("button", { name: "Second result" });
    second.focus();
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    second.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(second);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("second");
  },
);

it.each([false, true])(
  "preserves modified text navigation and IME candidate confirmation (compact=%s)",
  async (compact) => {
    fixture.compact = compact;
    const onSelect = vi.fn();
    render(<Picker onSelect={onSelect} />);
    const input = await screen.findByRole("combobox", { name: "Search results" });
    await waitFor(() => expect(input.getAttribute("aria-activedescendant")).toContain("first"));
    const original = input.getAttribute("aria-activedescendant");
    input.focus();
    const modified = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(modified);
    expect(modified.defaultPrevented).toBe(false);
    expect(input.getAttribute("aria-activedescendant")).toBe(original);
    const composition = new KeyboardEvent("keydown", {
      key: "Enter",
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(composition);
    expect(composition.defaultPrevented).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
  },
);
