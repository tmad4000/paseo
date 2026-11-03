import React, { act, useCallback, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Pressable, Text, View } from "react-native";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { Combobox, ComboboxItem, type ComboboxProps } from "@/components/ui/combobox";
import { dispatchTopWebOverlayKeyDown } from "@/lib/overlay-root";
import { ProjectPickerPinToggle } from "./project-picker-ui";
import { i18n } from "@/i18n/i18next";
void i18n;
const state = vi.hoisted(() => ({
  compact: false,
  pinned: false,
  isDefault: false,
  supported: true,
  listeners: new Set<() => void>(),
  globalKey: vi.fn(),
  toggle: vi.fn(),
  select: vi.fn(),
}));
vi.mock("./hooks", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useProjectPinStates: () => new Map(),
    useProjectPinState: () => {
      const pinned = useSyncExternalStore(
        (notify) => {
          state.listeners.add(notify);
          return () => state.listeners.delete(notify);
        },
        () => state.pinned,
      );
      return pinned || state.isDefault ? { pinned: true, isDefault: state.isDefault } : null;
    },
  };
});
vi.mock("./use-project-pin-actions", () => ({
  useProjectPinActions: () => ({
    setPinned: (_hosts: unknown, pinned: boolean) => {
      state.toggle(pinned);
      state.pinned = pinned;
      state.listeners.forEach((notify) => notify());
    },
  }),
}));
vi.mock("@/constants/layout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/constants/layout")>()),
  useIsCompactFormFactor: () => state.compact,
}));
vi.mock("@/runtime/host-features", () => ({
  useHostFeatureMap: () => new Map([["fixture", state.supported]]),
}));
vi.mock("react-native-reanimated", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native-reanimated")>();
  const { View: MockView } = await import("react-native");
  const animation = { duration: () => animation };
  return {
    ...actual,
    default: { ...actual.default, View: MockView },
    FadeIn: animation,
    FadeOut: animation,
  };
});
const hosts = [{ serverId: "fixture", projectId: "beta" }];
const options = [
  { id: "alpha", label: "Alpha" },
  { id: "beta", label: "Beta" },
];
const triggerStyle = { width: 200, height: 40 };
const favoritePin = (
  <ProjectPickerPinToggle hosts={hosts} projectName="Beta" testID="favorite-toggle" />
);
const renderProjectOption: NonNullable<ComboboxProps["renderOption"]> = ({ option, ...props }) => {
  const trailingSlot = option.id === "beta" ? favoritePin : null;
  return (
    <ComboboxItem
      {...props}
      label={option.label}
      testID={`row-${option.id}`}
      trailingSlot={trailingSlot}
    />
  );
};
function Picker() {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<View>(null);
  const showPicker = useCallback(() => setOpen(true), []);
  const select = useCallback((id: string) => {
    state.select(id);
    setOpen(false);
  }, []);
  return (
    <View>
      <Pressable
        ref={anchorRef}
        onPress={showPicker}
        accessibilityRole="button"
        accessibilityLabel="Choose project"
        style={triggerStyle}
      >
        <Text>Choose project</Text>
      </Pressable>
      <Combobox
        options={options}
        value="alpha"
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchorRef}
        searchable
        searchPlaceholder="Search projects"
        onSelect={select}
        renderOption={renderProjectOption}
      />
    </View>
  );
}

let root: Root;
let container: HTMLDivElement;
function appShortcutConsumer(event: KeyboardEvent) {
  if (dispatchTopWebOverlayKeyDown(event)) return;
  if (event.key === "Enter" || event.key === " ") state.globalKey(event.key);
}
beforeEach(async () => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.compact = false;
  state.pinned = false;
  state.isDefault = false;
  state.supported = true;
  state.globalKey.mockClear();
  state.toggle.mockClear();
  window.addEventListener("keydown", appShortcutConsumer, true);
  state.select.mockClear();
  container = document.createElement("div");
  container.style.cssText = "padding:40px;width:500px";
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  window.removeEventListener("keydown", appShortcutConsumer, true);
  vi.unstubAllGlobals();
});
async function openPickerFixture() {
  await act(async () => root.render(<Picker />));
  await page.getByRole("button", { name: "Choose project" }).click();
  await expect.element(page.getByPlaceholder("Search projects")).toBeVisible();
}

test("Enter on a project pin activates only the pin and leaves the picker open", async () => {
  await openPickerFixture();
  await expect.element(page.getByTestId("favorite-toggle")).toBeVisible();
  page.getByTestId("favorite-toggle").element().focus();
  await expect.element(page.getByTestId("favorite-toggle")).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  expect(state.toggle).toHaveBeenCalledWith(true);
  expect(state.globalKey).not.toHaveBeenCalled();
  expect(state.select).not.toHaveBeenCalled();
  await expect.element(page.getByTestId("favorite-toggle")).toBeVisible();
  await expect.element(page.getByTestId("favorite-toggle")).toHaveAttribute("aria-pressed", "true");
});
test("Space and pointer activation toggle without choosing the enclosing row", async () => {
  await openPickerFixture();
  await expect.element(page.getByTestId("favorite-toggle")).toBeVisible();
  page.getByTestId("favorite-toggle").element().focus();
  await expect.element(page.getByTestId("favorite-toggle")).toHaveFocus();
  await userEvent.keyboard(" ");
  expect(state.toggle).toHaveBeenLastCalledWith(true);
  expect(state.globalKey).not.toHaveBeenCalled();
  expect(state.select).not.toHaveBeenCalled();
  await page.getByTestId("favorite-toggle").click();
  expect(state.toggle).toHaveBeenLastCalledWith(false);
  expect(state.select).not.toHaveBeenCalled();
  await expect.element(page.getByTestId("favorite-toggle")).toBeVisible();
});
test("search Enter still chooses a project; Escape from the pin closes the picker", async () => {
  await openPickerFixture();
  await userEvent.keyboard("{Enter}");
  expect(state.select).toHaveBeenCalledWith("alpha");
  await page.getByRole("button", { name: "Choose project" }).click();
  await expect.element(page.getByTestId("favorite-toggle")).toBeVisible();
  page.getByTestId("favorite-toggle").element().focus();
  await expect.element(page.getByTestId("favorite-toggle")).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  await expect.element(page.getByTestId("favorite-toggle")).not.toBeInTheDocument();
  await expect.element(page.getByRole("button", { name: "Choose project" })).toHaveFocus();
});
test("the pin identifies its project and explains itself on hover", async () => {
  await openPickerFixture();
  const pin = page.getByTestId("favorite-toggle");
  await expect.element(pin).toHaveAccessibleName("Pin project: Beta");
  await pin.hover();
  await expect.element(page.getByText("Pin project", { exact: true })).toBeVisible();
});
test("the Default project is marked rather than unpinned", async () => {
  state.isDefault = true;
  await openPickerFixture();
  await expect.element(page.getByTestId("favorite-toggle-default")).toBeVisible();
  await expect.element(page.getByTestId("favorite-toggle")).not.toBeInTheDocument();
  expect(state.toggle).not.toHaveBeenCalled();
});

test("hosts without projectPinning omit the action and retain row selection", async () => {
  state.supported = false;
  await openPickerFixture();
  await expect.element(page.getByTestId("favorite-toggle")).not.toBeInTheDocument();
  await page.getByTestId("row-beta").click();
  expect(state.select).toHaveBeenCalledWith("beta");
});
test("compact layouts keep a visible thumb-sized pin target", async () => {
  state.compact = true;
  await act(async () =>
    root.render(<ProjectPickerPinToggle hosts={hosts} projectName="Beta" testID="compact-pin" />),
  );
  const control = page.getByTestId("compact-pin");
  await expect.element(control).toBeVisible();
  const box = control.element().getBoundingClientRect();
  expect(box.width).toBeGreaterThanOrEqual(40);
  expect(box.height).toBeGreaterThanOrEqual(40);
  await control.click();
  expect(state.toggle).toHaveBeenCalledWith(true);
});
