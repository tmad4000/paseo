// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { GlobalStreamRow } from "@/companion-stream/use-global-stream";
import { useNeedsYouSeen } from "@/companion-stream/needs-you-seen";

const navigation = vi.hoisted(() => ({
  pathname: "/",
  view: undefined as string | undefined,
  events: [] as string[],
  rows: [] as GlobalStreamRow[],
  streamOptions: vi.fn(),
  navigate: vi.fn((route: string) => navigation.events.push(route)),
}));
// Tooltips are desktop hover chrome; these tests exercise the controls, not their hover labels.
vi.mock("@/components/ui/icon-tooltip", () => ({
  IconTooltip: ({ children }: { children: unknown }) => children,
}));

vi.mock("expo-router", () => ({
  router: { navigate: navigation.navigate, push: vi.fn() },
  usePathname: () => navigation.pathname,
  useGlobalSearchParams: () => ({ view: navigation.view }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Pressable: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/styles/theme", () => ({ ICON_SIZE: { sm: 16 } }));
vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => ({}) },
  withUnistyles: (component: unknown) => component,
}));
vi.mock("lucide-react-native", () => ({
  LayoutPanelLeft: () => null,
  Plus: () => null,
  ListFilter: () => null,
  CircleHelp: () => null,
}));
vi.mock("@/components/sidebar/sidebar-header-row", () => ({
  SidebarHeaderRow: ({
    label,
    badge,
    onPress,
    isActive,
  }: {
    label: string;
    badge?: string;
    onPress: () => void;
    isActive?: boolean;
  }) => (
    <button type="button" aria-pressed={isActive} onClick={onPress}>
      {label}
      {badge ? <span data-testid="unread-badge">{badge}</span> : null}
    </button>
  ),
}));
vi.mock("@/companion-stream/use-global-stream", () => ({
  useGlobalStream: (options: unknown) => {
    navigation.streamOptions(options);
    return { rows: navigation.rows, hasNextPage: false, isFetching: false };
  },
}));
const emptyViews = { order: [], views: {} };
vi.mock("@/stores/views-store", () => ({
  useViewsStore: (selector: (state: typeof emptyViews) => unknown) => selector(emptyViews),
}));
import { SidebarStreamNavigation, SidebarViewsSection } from "./sidebar-views-section";

beforeEach(() => {
  vi.stubGlobal("React", React);
  navigation.pathname = "/";
  navigation.view = undefined;
  navigation.events.length = 0;
  navigation.navigate.mockClear();
  navigation.rows = [];
  navigation.streamOptions.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function closeDrawer() {
  navigation.events.push("close drawer");
}

it("exposes global attention without any workspace or saved view dependency", () => {
  const screen = render(<SidebarStreamNavigation />);
  fireEvent.click(screen.getByRole("button", { name: "globalStream.needsYou" }));
  expect(navigation.navigate).toHaveBeenCalledWith("/stream?view=needs_you");
});

it("does not duplicate attention when the project-list header is also mounted", () => {
  const screen = render(
    <>
      <SidebarStreamNavigation />
      <SidebarViewsSection />
    </>,
  );
  expect(screen.getAllByRole("button", { name: "globalStream.needsYou" })).toHaveLength(1);
  expect(screen.getAllByRole("button", { name: "globalStream.title" })).toHaveLength(1);
});

it("closes the mobile drawer before navigating for both global destinations", () => {
  const screen = render(<SidebarStreamNavigation onBeforeNavigate={closeDrawer} />);
  fireEvent.click(screen.getByRole("button", { name: "globalStream.needsYou" }));
  fireEvent.click(screen.getByRole("button", { name: "globalStream.title" }));
  expect(navigation.events).toEqual([
    "close drawer",
    "/stream?view=needs_you",
    "close drawer",
    "/stream",
  ]);
});

it("highlights Needs you separately from other Stream views", () => {
  navigation.pathname = "/stream";
  navigation.view = "needs_you";
  const screen = render(<SidebarStreamNavigation />);
  expect(
    screen.getByRole("button", { name: "globalStream.needsYou" }).getAttribute("aria-pressed"),
  ).toBe("true");
  expect(
    screen.getByRole("button", { name: "globalStream.title" }).getAttribute("aria-pressed"),
  ).toBe("false");
  navigation.view = "tasks";
  screen.rerender(<SidebarStreamNavigation />);
  expect(
    screen.getByRole("button", { name: "globalStream.needsYou" }).getAttribute("aria-pressed"),
  ).toBe("false");
  expect(
    screen.getByRole("button", { name: "globalStream.title" }).getAttribute("aria-pressed"),
  ).toBe("true");
});

it("counts archived requests like the default feed and clears a viewed request's badge", () => {
  const request: GlobalStreamRow = {
    id: "unread",
    timestamp: "2026-11-15T12:00:00Z",
    serverId: "host",
    serverLabel: "Host",
    agentId: "agent",
    agentTitle: "Chat",
    cwd: "/p",
    archived: true,
    item: {
      kind: "entry",
      entry: {
        id: "question:unread",
        kind: "question",
        status: "open",
        timestamp: "2026-11-15T12:00:00Z",
        text: "Choose a name",
        truncated: false,
      },
    },
  };
  navigation.rows = [request];
  useNeedsYouSeen.setState({ hydrated: true, seen: {} });
  const screen = render(<SidebarStreamNavigation />);
  expect(navigation.streamOptions).toHaveBeenLastCalledWith(
    expect.objectContaining({ view: "needs_you", includeArchived: true }),
  );
  expect(screen.getByTestId("unread-badge").textContent).toBe("1");
  act(() => useNeedsYouSeen.getState().markSeen([request]));
  expect(screen.queryByTestId("unread-badge")).toBeNull();
});
