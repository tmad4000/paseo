import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { AssistantMarkdownLink } from "@/assistant-file-links/link";
import { MarkdownTextSpan } from "@/components/markdown-text";
import { MessagePinControl } from "@/companion-stream/message-pin-control";
import { ToastApiProvider } from "@/contexts/toast-api-context";
import { i18n } from "@/i18n/i18next";
void i18n;
const fixture = vi.hoisted(() => ({
  open: vi.fn(async () => undefined),
  copy: vi.fn(async () => undefined),
  pin: vi.fn(async () => undefined),
  error: vi.fn(),
  copied: vi.fn(),
  compact: false,
  window: true,
}));
vi.mock("@/navigation/session-link-runtime", () => ({
  openSessionLink: fixture.open,
  canOpenSessionWindow: () => fixture.window,
}));
vi.mock("expo-clipboard", () => ({ setStringAsync: fixture.copy }));
vi.mock("@/companion-stream/stream-tag-scope", () => ({
  useStreamTagSuggestions: () => ({ supported: false, tags: [] }),
}));
vi.mock("@/constants/layout", async (original) => ({
  ...(await original<typeof import("@/constants/layout")>()),
  useIsCompactFormFactor: () => fixture.compact,
}));
vi.mock("expo-router", () => ({
  router: {},
  useRouter: () => ({}),
  usePathname: () => "/fixture",
  useLocalSearchParams: () => ({}),
}));
// Gorhom's native animated presenter cannot lay out in this isolated browser fixture.
vi.mock("@/components/ui/isolated-bottom-sheet-modal", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/ui/isolated-bottom-sheet-modal")>();
  const MockReact = await import("react");
  return {
    ...actual,
    IsolatedBottomSheetModal: MockReact.forwardRef<
      { present: () => void; dismiss: () => void },
      {
        children: React.ReactNode;
        contextBridge: (children: React.ReactNode) => React.ReactNode;
        onChange?: (index: number) => void;
        onDismiss?: () => void;
      }
    >(function TestSheet({ children, contextBridge, onChange, onDismiss }, ref) {
      const [open, setOpen] = MockReact.useState(false);
      MockReact.useImperativeHandle(ref, () => ({
        present: () => {
          setOpen(true);
          onChange?.(0);
        },
        dismiss: () => {
          setOpen(false);
          onChange?.(-1);
          onDismiss?.();
        },
      }));
      return open ? contextBridge(children) : null;
    }),
  };
});
vi.mock("@gorhom/bottom-sheet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@gorhom/bottom-sheet")>();
  const { ScrollView } = await import("react-native");
  return { ...actual, BottomSheetScrollView: ScrollView };
});
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

const href = "paseo-fork://h/saved/agent/session";
let root: Root;
let container: HTMLDivElement;
const toast = { show: vi.fn(), copied: fixture.copied, error: fixture.error };
const source = { href, text: "Visit session" };
const linkStyle = { color: "blue" };
const emptyStyle = {};
const content = () => `[Visit session](${href})`;
async function render() {
  await act(async () =>
    root.render(
      <ToastApiProvider api={toast}>
        <MessagePinControl getContent={content} onPin={fixture.pin}>
          <AssistantMarkdownLink source={source} style={linkStyle}>
            <MarkdownTextSpan style={emptyStyle}>Visit session</MarkdownTextSpan>
          </AssistantMarkdownLink>
        </MessagePinControl>
      </ToastApiProvider>,
    ),
  );
}
beforeEach(async () => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fixture.compact = false;
  fixture.window = true;
  fixture.open.mockReset();
  fixture.copy.mockReset();
  fixture.pin.mockReset();
  fixture.error.mockReset();
  fixture.copied.mockReset();
  container = document.createElement("div");
  container.style.cssText = "padding:40px;width:500px";
  document.body.append(container);
  root = createRoot(container);
  await render();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
test("real href, ordinary click and keyboard Enter open the session once", async () => {
  const link = page.getByRole("link", { name: "Visit session" });
  await expect.element(link).toHaveAttribute("href", href);
  await link.click();
  expect(fixture.open).toHaveBeenLastCalledWith(href, "current", expect.any(Function));
  fixture.open.mockClear();
  (container.querySelector("a") as HTMLAnchorElement).focus();
  await userEvent.keyboard("{Enter}");
  expect(fixture.open).toHaveBeenCalledExactlyOnceWith(href, "current", expect.any(Function));
});
test("Cmd, Ctrl and middle click open a supported desktop window", async () => {
  const link = page.getByRole("link", { name: "Visit session" });
  await link.click({ modifiers: ["Meta"] });
  await link.click({ modifiers: ["Control"] });
  await link.click({ button: "middle" });
  expect(fixture.open.mock.calls).toEqual([
    [href, "window", expect.any(Function)],
    [href, "window", expect.any(Function)],
    [href, "window", expect.any(Function)],
  ]);
});
test("browser modifier click opens beside; Shift requests a window explicitly", async () => {
  fixture.window = false;
  await render();
  await page.getByRole("link", { name: "Visit session" }).click({ modifiers: ["Control"] });
  expect(fixture.open).toHaveBeenLastCalledWith(href, "side", expect.any(Function));
  await page.getByRole("link", { name: "Visit session" }).click({ modifiers: ["Shift"] });
  expect(fixture.open).toHaveBeenLastCalledWith(href, "window", expect.any(Function));
});
for (const compact of [false, true])
  test(`right-click menu preserves Save to Stream and Copy link (compact=${compact})`, async () => {
    fixture.compact = compact;
    await render();
    await page.getByRole("link", { name: "Visit session" }).click({ button: "right" });
    await expect.element(page.getByText("Open session", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Save message to Stream", { exact: true })).toBeVisible();
    await page.getByText("Copy link", { exact: true }).click();
    expect(fixture.copy).toHaveBeenCalledExactlyOnceWith(href);
    await expect.element(page.getByText("Copy link", { exact: true })).not.toBeInTheDocument();
    await page.getByRole("link", { name: "Visit session" }).click({ button: "right" });
    await page.getByText("Open session", { exact: true }).click();
    expect(fixture.open).toHaveBeenLastCalledWith(href, "current", expect.any(Function));
    await expect.element(page.getByText("Copy link", { exact: true })).not.toBeInTheDocument();
    await page.getByRole("link", { name: "Visit session" }).click({ button: "right" });
    await page.getByText("Save message to Stream", { exact: true }).click();
    expect(fixture.pin).toHaveBeenCalled();
  });
test("menu clearly identifies unavailable windows", async () => {
  fixture.window = false;
  await render();
  await page.getByRole("link", { name: "Visit session" }).click({ button: "right" });
  await expect
    .element(page.getByText("New window unavailable here — use Open session", { exact: true }))
    .toBeVisible();
});
