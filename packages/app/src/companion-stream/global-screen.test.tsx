// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { GlobalStreamRow } from "./use-global-stream";

const state = vi.hoisted(() => ({
  supported: true,
  connection: "online",
  updateStreamEntry: vi.fn().mockResolvedValue(undefined),
  updateStatus: undefined as undefined | ((id: string, status: "done") => void),
}));
function clickDone() {
  state.updateStatus?.("question:q", "done");
}
vi.mock("react-native", () => ({
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  FlatList: () => null,
}));
vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => ({}) },
  withUnistyles: (component: unknown) => component,
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@react-navigation/native", () => ({ useIsFocused: () => true }));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: (selector: (store: unknown) => unknown) =>
    selector({
      sessions: { host: { serverInfo: { features: { globalStream: state.supported } } } },
    }),
}));
vi.mock("@/runtime/host-runtime", () => ({
  useHosts: () => [],
  useHostRuntimeClient: () => ({ updateStreamEntry: state.updateStreamEntry }),
  useHostRuntimeConnectionStatus: () => state.connection,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) => (
    <button type="button" onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/headers/menu-header", () => ({ MenuHeader: () => null }));
vi.mock("@/components/ui/search-field", () => ({ SearchField: () => null }));
vi.mock("@/components/ui/segmented-control", () => ({ SegmentedControl: () => null }));
vi.mock("@/components/ui/loading-spinner", () => ({ LoadingSpinner: () => null }));
vi.mock("@/components/hosts/host-filter", () => ({ HostFilter: () => null }));
vi.mock("@/components/hosts/host-picker", () => ({ ALL_HOSTS_OPTION_ID: "all" }));
vi.mock("@/hooks/use-debounced-value", () => ({ useDebouncedValue: (value: unknown) => value }));
vi.mock("@/utils/navigate-to-agent", () => ({ navigateToAgent: vi.fn() }));
vi.mock("./use-global-stream", () => ({ useGlobalStream: vi.fn() }));
vi.mock("./feed", () => ({
  EntryCard: ({
    disabled,
    onUpdateStatus,
  }: {
    disabled: boolean;
    onUpdateStatus: typeof state.updateStatus;
  }) => {
    state.updateStatus = onUpdateStatus;
    return (
      <button type="button" disabled={disabled} onClick={clickDone}>
        Done
      </button>
    );
  },
}));

import { GlobalStreamCard } from "./global-screen";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const row: GlobalStreamRow = {
  id: "row",
  timestamp: "2026-10-05T00:00:00Z",
  serverId: "host",
  serverLabel: "Host",
  agentId: "agent",
  agentTitle: "Chat",
  cwd: "/project",
  archived: false,
  item: {
    kind: "entry",
    entry: {
      id: "question:q",
      kind: "question",
      text: "Choose name",
      status: "open",
      timestamp: "2026-10-05T00:00:00Z",
      truncated: false,
    },
  },
};
it("blocks cached-card writes when a reconnected host loses global Stream capability", async () => {
  vi.stubGlobal("React", React);
  const onSaved = vi.fn();
  const rendered = render(<GlobalStreamCard row={row} onSaved={onSaved} />);
  expect((rendered.getByText("Done") as HTMLButtonElement).disabled).toBe(false);
  state.supported = false;
  rendered.rerender(<GlobalStreamCard row={row} onSaved={onSaved} />);
  expect((rendered.getByText("Done") as HTMLButtonElement).disabled).toBe(true);
  state.updateStatus?.("question:q", "done");
  expect(state.updateStreamEntry).not.toHaveBeenCalled();
  state.supported = true;
  state.connection = "offline";
  rendered.rerender(<GlobalStreamCard row={row} onSaved={onSaved} />);
  expect((rendered.getByText("Done") as HTMLButtonElement).disabled).toBe(true);
  state.updateStatus?.("question:q", "done");
  expect(state.updateStreamEntry).not.toHaveBeenCalled();
  state.connection = "online";
  rendered.rerender(<GlobalStreamCard row={row} onSaved={onSaved} />);
  fireEvent.click(rendered.getByText("Done"));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(state.updateStreamEntry).toHaveBeenCalledExactlyOnceWith({
    agentId: "agent",
    entryId: "question:q",
    action: "update_status",
    status: "done",
  });
});
