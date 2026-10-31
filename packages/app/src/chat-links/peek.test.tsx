// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import { extractChatLinks } from "./model";
import { chatLinksFixtureRows, CHAT_LINKS_FIXTURE_URLS } from "./fixture";
import {
  PEEK_LOAD_TIMEOUT_MS,
  isKnownFrameBlocked,
  peekScale,
  usePeekFrameStatus,
} from "./peek-model";

vi.mock("react-native", () => ({
  View: ({ children, testID }: { children?: React.ReactNode; testID?: string }) => (
    <div data-testid={testID}>{children}</div>
  ),
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  useWindowDimensions: () => ({ width: 1440, height: 900 }),
}));
vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => new Proxy({}, { get: () => ({}) }), absoluteFillObject: {} },
  withUnistyles: () => () => null,
}));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: i18n.t.bind(i18n) }),
}));
vi.mock("lucide-react-native", () => ({ Globe: () => null }));
vi.mock("@/components/ui/loading-spinner", () => ({ LoadingSpinner: () => null }));
vi.mock("@/constants/platform", () => ({ isWeb: true }));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onPress,
    testID,
  }: {
    children: React.ReactNode;
    onPress?: () => void;
    testID?: string;
  }) => (
    <button type="button" data-testid={testID} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/adaptive-modal-sheet", () => ({
  AdaptiveModalSheet: ({
    visible,
    children,
    footer,
  }: {
    visible: boolean;
    children: React.ReactNode;
    footer?: React.ReactNode;
  }) =>
    visible ? (
      <div data-testid="sheet">
        {children}
        {footer}
      </div>
    ) : null,
}));
vi.mock("./peek-frame", () => ({
  PeekFrame: ({ url }: { url: string }) => <div data-testid="frame">{url}</div>,
}));

const { LinkPeek } = await import("./peek");

const links = extractChatLinks(chatLinksFixtureRows());
const lavish = links.find((link) => link.url === CHAT_LINKS_FIXTURE_URLS.lavishFirst)!;
const pr = links.find((link) => link.url === CHAT_LINKS_FIXTURE_URLS.pr)!;
const actions = { open: vi.fn(), copy: vi.fn(), jump: vi.fn(), canJump: () => true };

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("usePeekFrameStatus", () => {
  it("is loading until load, and stays loaded past the timeout", () => {
    const { result } = renderHook(() => usePeekFrameStatus({ url: lavish.url }));
    expect(result.current.status).toBe("loading");
    act(() => result.current.onLoad());
    act(() => vi.advanceTimersByTime(PEEK_LOAD_TIMEOUT_MS + 1));
    expect(result.current.status).toBe("loaded");
  });

  it("gives up after the timeout when the frame never loads", () => {
    const { result } = renderHook(() => usePeekFrameStatus({ url: lavish.url }));
    act(() => vi.advanceTimersByTime(PEEK_LOAD_TIMEOUT_MS - 1));
    expect(result.current.status).toBe("loading");
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.status).toBe("blocked");
  });

  it("blocks known frame-refusing hosts and same-origin pages at once", () => {
    expect(renderHook(() => usePeekFrameStatus({ url: pr.url })).result.current.status).toBe(
      "blocked",
    );
    const sameOrigin = `${window.location.origin}/anything`;
    expect(renderHook(() => usePeekFrameStatus({ url: sameOrigin })).result.current.status).toBe(
      "blocked",
    );
    expect(isKnownFrameBlocked("https://gist.github.com/x")).toBe(true);
    expect(isKnownFrameBlocked("https://m4-mini.tailb2a35c.ts.net:4387/session/a")).toBe(false);
  });
});

describe("peekScale", () => {
  it("fits a 1280×800 viewport inside the body and never enlarges it", () => {
    expect(peekScale({ width: 640, height: 600 })).toBe(0.5);
    expect(peekScale({ width: 2000, height: 2000 })).toBe(1);
  });
});

describe("LinkPeek", () => {
  it("swaps the frame for the fallback card when the page never loads", () => {
    render(<LinkPeek link={lavish} actions={actions} onClose={vi.fn()} />);
    expect(screen.getByTestId("frame").textContent).toBe(lavish.url);
    act(() => vi.advanceTimersByTime(PEEK_LOAD_TIMEOUT_MS));
    expect(screen.queryByTestId("frame")).toBeNull();
    expect(screen.getByTestId("chat-link-peek-fallback").textContent).toContain(
      "This page can't be previewed here",
    );
    act(() => screen.getByTestId("chat-link-peek-fallback-open").click());
    expect(actions.open).toHaveBeenCalledWith(lavish);
  });

  it("shows the fallback card straight away for a host that refuses framing", () => {
    render(<LinkPeek link={pr} actions={actions} onClose={vi.fn()} />);
    expect(screen.getByTestId("chat-link-peek-fallback").textContent).toContain(pr.url);
  });

  it("renders nothing while no link is peeked", () => {
    const { container } = render(<LinkPeek link={null} actions={actions} onClose={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });
});
