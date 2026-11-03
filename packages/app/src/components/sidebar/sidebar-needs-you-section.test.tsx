// @vitest-environment jsdom
/* eslint-disable react-perf/jsx-no-new-function-as-prop -- test doubles */
import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompanionEntry } from "@getpaseo/protocol/companion-stream";
import type { GlobalStreamRow } from "@/companion-stream/use-global-stream";

const state = vi.hoisted(() => ({
  rows: [] as unknown[],
  hasNextPage: false,
  updateStreamEntry: vi.fn().mockResolvedValue(undefined),
  refetch: vi.fn().mockResolvedValue(undefined),
  navigate: vi.fn(),
}));

vi.mock("react-native", () => ({
  Platform: {
    OS: "web",
    select: (options: { web?: unknown; default?: unknown }) => options.web ?? options.default,
  },
  View: ({
    children,
    testID,
    onPointerEnter,
    onPointerLeave,
  }: {
    children?: React.ReactNode;
    testID?: string;
    onPointerEnter?: () => void;
    onPointerLeave?: () => void;
  }) => (
    <div data-testid={testID} onMouseEnter={onPointerEnter} onMouseLeave={onPointerLeave}>
      {children}
    </div>
  ),
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  Pressable: ({
    children,
    onPress,
    testID,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    testID?: string;
  }) => (
    <button type="button" data-testid={testID} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => ({}) },
  withUnistyles: () => () => null,
}));
vi.mock("lucide-react-native", () => ({
  Ban: () => null,
  ChevronDown: () => null,
  ChevronRight: () => null,
  CircleHelp: () => null,
  Lock: () => null,
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: string }) =>
      options?.count !== undefined ? `${key}:${options.count}` : key,
  }),
}));
vi.mock("expo-router", () => ({ router: { navigate: state.navigate } }));
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => false }));
vi.mock("@/constants/platform", () => ({ isNative: false }));
vi.mock("@/components/hosts/host-picker", () => ({ ALL_HOSTS_OPTION_ID: "all" }));
vi.mock("@/utils/navigate-to-agent", () => ({ navigateToAgent: vi.fn() }));
vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({
    getClient: () => ({ updateStreamEntry: state.updateStreamEntry }),
  }),
}));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: (selector: (store: unknown) => unknown) =>
    selector({ sessions: { host: { serverInfo: { features: { streamDefer: true } } } } }),
}));
vi.mock("@/companion-stream/use-global-stream", () => ({
  useGlobalStream: () => ({
    rows: state.rows,
    hasNextPage: state.hasNextPage,
    notices: [],
    refetch: state.refetch,
  }),
}));

import { SidebarNeedsYouSection } from "./sidebar-needs-you-section";
import { useNeedsYouSectionStore } from "@/companion-stream/needs-you-section-store";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { useStreamReturnStore } from "@/companion-stream/stream-return";

function row(id: string, entry: Partial<CompanionEntry> = {}): GlobalStreamRow {
  return {
    id,
    timestamp: "2026-11-03T00:00:00Z",
    serverId: "host",
    serverLabel: "Host",
    agentId: `agent-${id}`,
    agentTitle: `Chat ${id}`,
    cwd: "/p",
    archived: false,
    item: {
      kind: "entry",
      entry: {
        id: `question:${id}`,
        kind: "question",
        status: "open",
        timestamp: "2026-11-03T00:00:00Z",
        text: `Question ${id}`,
        truncated: false,
        ...entry,
      } as CompanionEntry,
    },
  };
}
const blocked = row("b", {
  id: "ask:b",
  text: "Deploy",
  ask: {
    state: "blocked",
    remaining: "Needs your go-ahead to deploy\nThen verify.",
    evidence: "",
    revision: 1,
    provenance: "explicit",
  },
});

beforeEach(() => {
  vi.stubGlobal("React", React);
  state.rows = [];
  state.hasNextPage = false;
  state.updateStreamEntry.mockClear();
  state.navigate.mockClear();
  useNeedsYouSectionStore.setState({ enabled: true, collapsed: false });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SidebarNeedsYouSection", () => {
  it("is hidden when nothing waits, or when turned off", () => {
    expect(
      render(<SidebarNeedsYouSection />).queryByTestId("sidebar-needs-you-section"),
    ).toBeNull();
    cleanup();
    state.rows = [row("a")];
    useNeedsYouSectionStore.setState({ enabled: false });
    expect(
      render(<SidebarNeedsYouSection />).queryByTestId("sidebar-needs-you-section"),
    ).toBeNull();
  });

  it("caps at five rows with blocked first, and links the rest to Needs you", () => {
    state.rows = [
      ...["1", "2", "3", "4", "5", "6"].map((id) => row(id)),
      blocked,
      row("later", { deferredAt: "2026-11-03" }),
    ];
    const view = render(<SidebarNeedsYouSection />);
    expect(view.getByText("sidebar.needsYou.title:7")).toBeTruthy();
    const rows = view.getAllByTestId("sidebar-needs-you-row");
    expect(rows).toHaveLength(5);
    expect(rows[0].textContent).toContain("Needs your go-ahead to deploy");
    expect(view.queryByText("Question later")).toBeNull();
    fireEvent.click(view.getByTestId("sidebar-needs-you-section-more"));
    expect(state.navigate).toHaveBeenCalledWith("/stream?view=needs_you");
  });

  it("says N+ while more pages exist, and collapse is remembered", () => {
    state.rows = [row("a")];
    state.hasNextPage = true;
    const view = render(<SidebarNeedsYouSection />);
    expect(view.getByText("sidebar.needsYou.title:1+")).toBeTruthy();
    fireEvent.click(view.getByTestId("sidebar-needs-you-section-header"));
    expect(useNeedsYouSectionStore.getState().collapsed).toBe(true);
    expect(view.queryAllByTestId("sidebar-needs-you-row")).toHaveLength(0);
    expect(view.getByText("sidebar.needsYou.title:1+")).toBeTruthy();
  });

  it("opens the chat with the way back to Needs you, and Later on hover sets it aside", async () => {
    state.rows = [blocked];
    const view = render(<SidebarNeedsYouSection />);
    fireEvent.click(view.getByTestId("sidebar-needs-you-row"));
    expect(navigateToAgent).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: "host", agentId: "agent-b" }),
    );
    expect(useStreamReturnStore.getState().target?.place.view).toBe("needs_you");
    fireEvent.mouseEnter(view.getByTestId("sidebar-needs-you-row-agent-b"));
    await act(async () => {
      fireEvent.click(view.getByTestId("sidebar-needs-you-later"));
    });
    expect(state.updateStreamEntry).toHaveBeenCalledWith({
      agentId: "agent-b",
      entryId: "ask:b",
      action: "set_deferred",
      deferred: true,
    });
  });
});
