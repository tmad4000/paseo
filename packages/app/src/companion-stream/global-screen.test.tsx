// @vitest-environment jsdom
/* eslint-disable react-perf/jsx-no-new-object-as-prop, react-perf/jsx-no-new-function-as-prop -- tests deliberately replace props and mock control handlers */
import React from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CompanionEntry } from "@getpaseo/protocol/companion-stream";
import type { GlobalStreamRow } from "./use-global-stream";

const state = vi.hoisted(() => ({
  supported: true,
  answersSupported: true,
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
  FlatList: ({
    ListHeaderComponent,
    ListEmptyComponent,
    ListFooterComponent,
  }: {
    ListHeaderComponent?: React.ReactNode;
    ListEmptyComponent?: React.ReactNode;
    ListFooterComponent?: React.ReactNode;
  }) => (
    <div>
      {ListHeaderComponent}
      {ListEmptyComponent}
      {ListFooterComponent}
    </div>
  ),
}));
vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => ({}) },
  withUnistyles: (component: unknown) => component,
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("expo-router", () => ({ useLocalSearchParams: () => ({}) }));
vi.mock("@react-navigation/native", () => ({ useIsFocused: () => true }));
vi.mock("@/components/retained-panel", () => ({ useRetainedPanelActive: () => true }));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: (selector: (store: unknown) => unknown) =>
    selector({
      sessions: {
        host: {
          serverInfo: {
            features: { globalStream: state.supported, streamAnswers: state.answersSupported },
          },
        },
      },
    }),
}));
vi.mock("@/runtime/host-runtime", () => ({
  useHosts: () => [],
  useHostRuntimeClient: () => ({ updateStreamEntry: state.updateStreamEntry }),
  useHostRuntimeConnectionStatus: () => state.connection,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onPress,
    disabled,
  }: {
    children: React.ReactNode;
    onPress?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/headers/menu-header", () => ({ MenuHeader: () => null }));
vi.mock("@/components/ui/search-field", () => ({ SearchField: () => null }));
vi.mock("@/components/ui/segmented-control", () => ({
  SegmentedControl: ({
    options,
    onValueChange,
  }: {
    options: Array<{ value: string; label: string }>;
    onValueChange: (value: string) => void;
  }) => (
    <div>
      {options.map((option) => (
        <button type="button" key={option.value} onClick={() => onValueChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  ),
}));
vi.mock("@/components/ui/loading-spinner", () => ({ LoadingSpinner: () => null }));
vi.mock("@/components/hosts/host-filter", () => ({ HostFilter: () => null }));
vi.mock("@/components/hosts/host-picker", () => ({ ALL_HOSTS_OPTION_ID: "all" }));
vi.mock("@/hooks/use-debounced-value", () => ({ useDebouncedValue: (value: unknown) => value }));
vi.mock("@/utils/navigate-to-agent", () => ({ navigateToAgent: vi.fn() }));
vi.mock("@/artifacts/feed", () => ({
  ArtifactCard: ({
    artifact,
    onOpen,
    onPin,
  }: {
    artifact: { path: string };
    onOpen: (artifact: { path: string }) => void;
    onPin?: () => void;
  }) => (
    <div>
      <button type="button" onClick={() => onOpen(artifact)}>
        Preview file
      </button>
      {onPin ? (
        <button type="button" onClick={onPin}>
          Pin file
        </button>
      ) : null}
    </div>
  ),
}));
vi.mock("./workflow-composer", () => ({ WorkflowComposer: () => null }));
vi.mock("./use-global-stream", () => ({ useGlobalStream: vi.fn() }));
vi.mock("./entry-card", () => ({
  EntryCard: ({
    entry,
    disabled,
    onUpdateStatus,
    onReturnToChat,
    onReplyInChat,
  }: {
    entry: CompanionEntry;
    disabled: boolean;
    onUpdateStatus: typeof state.updateStatus;
    onReturnToChat: () => void;
    onReplyInChat: (entry: CompanionEntry) => void;
  }) => {
    state.updateStatus = onUpdateStatus;
    return (
      <div>
        <button type="button" disabled={disabled} onClick={clickDone}>
          Done
        </button>
        <button type="button" onClick={onReturnToChat}>
          Return to Chat
        </button>
        <button type="button" onClick={() => onReplyInChat(entry)}>
          Reply in Chat
        </button>
      </div>
    );
  },
}));

import { GlobalStreamCard, StreamWorkflowFeed } from "./global-screen";
import { useGlobalStream } from "./use-global-stream";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { useAgentViewStore } from "@/stores/agent-view-store";

beforeEach(() => {
  state.supported = true;
  state.answersSupported = true;
  state.connection = "online";
  state.updateStreamEntry.mockReset().mockResolvedValue(undefined);
  vi.mocked(navigateToAgent).mockClear();
  vi.stubGlobal("React", React);
});

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

it("marks only the displayed answer revision seen after acknowledgement and preserves failures", async () => {
  const onSaved = vi.fn();
  const answered: GlobalStreamRow = {
    ...row,
    item: {
      kind: "entry",
      entry: {
        id: "ask:answer",
        kind: "question",
        status: "open",
        text: "Which version?",
        truncated: false,
        timestamp: row.timestamp,
        reply: {
          text: "Version 20",
          provenance: "explicit",
          revision: 2,
          answeredAt: row.timestamp,
        },
        replySeenRevision: 1,
      },
    },
  };
  state.updateStreamEntry.mockRejectedValueOnce(new Error("Save failed"));
  const rendered = render(<GlobalStreamCard row={answered} onSaved={onSaved} />);
  fireEvent.click(rendered.getByText("agentPanel.stream.answers.markSeen"));
  await waitFor(() => expect(rendered.getByText("Save failed").textContent).toBe("Save failed"));
  expect(onSaved).not.toHaveBeenCalled();
  fireEvent.click(rendered.getByText("agentPanel.stream.answers.markSeen"));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(state.updateStreamEntry).toHaveBeenLastCalledWith({
    agentId: "agent",
    entryId: "ask:answer",
    action: "mark_reply_seen",
    replyRevision: 2,
  });
  const seen: GlobalStreamRow = {
    ...answered,
    item: {
      kind: "entry",
      entry: {
        id: "ask:answer",
        kind: "question",
        text: "Which version?",
        status: "open",
        truncated: false,
        timestamp: row.timestamp,
        reply: {
          text: "Version 20",
          provenance: "explicit",
          revision: 2,
          answeredAt: row.timestamp,
        },
        replySeenRevision: 2,
      },
    },
  };
  rendered.rerender(<GlobalStreamCard row={seen} onSaved={onSaved} />);
  expect(rendered.queryByText("agentPanel.stream.answers.markSeen")).toBeNull();
});

it("uses the same query for local and global views without changing task or read state", () => {
  vi.mocked(useGlobalStream).mockReturnValue({
    rows: [],
    notices: ["M5: offline — cached items may be out of date"],
    refetch: vi.fn(),
    fetchNextPage: vi.fn(),
    isFetching: false,
    isLoading: false,
    hasNextPage: true,
    isFetchingNextPage: false,
    tagCounts: [],
    pinnedTags: [],
    supportsTags: false,
    setTagPinned: vi.fn(),
  });
  const rendered = render(<StreamWorkflowFeed scope={{ serverId: "host", agentId: "worker" }} />);
  fireEvent.click(rendered.getByText("globalStream.tasks"));
  expect(vi.mocked(useGlobalStream).mock.lastCall?.[0]).toMatchObject({
    view: "tasks",
    relatedAgentId: "worker",
    relatedServerId: "host",
    includeArchived: true,
    serverId: null,
  });
  fireEvent.click(rendered.getByText("agentPanel.stream.showUnresolved"));
  expect(vi.mocked(useGlobalStream).mock.lastCall?.[0]).toMatchObject({
    view: "tasks",
    filter: "pending",
  });
  fireEvent.click(rendered.getByText("agentPanel.stream.showCompleted"));
  expect(vi.mocked(useGlobalStream).mock.lastCall?.[0]).toMatchObject({
    view: "tasks",
    filter: "all",
  });
  fireEvent.click(rendered.getByText("globalStream.needsYou"));
  expect(vi.mocked(useGlobalStream).mock.lastCall?.[0]).toMatchObject({
    view: "needs_you",
    filter: "all",
    relatedAgentId: "worker",
  });
  fireEvent.click(rendered.getByText("globalStream.thisChat"));
  expect(vi.mocked(useGlobalStream).mock.lastCall?.[0]).toMatchObject({
    view: "needs_you",
    relatedAgentId: undefined,
    relatedServerId: undefined,
  });
  expect(rendered.getByText("M5: offline — cached items may be out of date").textContent).toBe(
    "M5: offline — cached items may be out of date",
  );
  expect(rendered.getByText("globalStream.partialCount").textContent).toBe(
    "globalStream.partialCount",
  );
  expect(state.updateStreamEntry).not.toHaveBeenCalled();
});

it("opens the original task and refuses writes to copied context", () => {
  const copied: GlobalStreamRow = {
    ...row,
    item: {
      kind: "entry",
      entry: {
        id: "ask:task",
        kind: "question",
        status: "open",
        text: "Copied task",
        truncated: false,
        timestamp: row.timestamp,
        ask: {
          state: "open",
          remaining: "",
          evidence: "",
          revision: 1,
          provenance: "explicit",
          taskId: "task-global",
          origin: { serverId: "m5", agentId: "original", entryId: "ask:task" },
        },
        reply: { text: "Result", provenance: "explicit", revision: 1, answeredAt: row.timestamp },
      },
    },
  };
  const rendered = render(<GlobalStreamCard row={copied} onSaved={vi.fn()} />);
  expect((rendered.getByText("Done") as HTMLButtonElement).disabled).toBe(true);
  expect(
    (rendered.getByText("agentPanel.stream.answers.markSeen") as HTMLButtonElement).disabled,
  ).toBe(true);
  state.updateStatus?.("ask:task", "done");
  expect(state.updateStreamEntry).not.toHaveBeenCalled();
  fireEvent.click(rendered.getByRole("button", { name: /globalStream.openTaskSource/ }));
  expect(navigateToAgent).toHaveBeenLastCalledWith({
    serverId: "m5",
    agentId: "original",
    workspaceId: undefined,
  });
  expect(rendered.getByText("globalStream.copiedTask").textContent).toBe("globalStream.copiedTask");
});

it("uses local Chat return and reply controls only for the same source session", () => {
  const context = {
    serverId: "host",
    agentId: "agent",
    cwd: "/project",
    artifactsSupported: true,
    onReturnToChat: vi.fn(),
    onReplyInChat: vi.fn(),
  };
  const rendered = render(<GlobalStreamCard row={row} onSaved={vi.fn()} localContext={context} />);
  fireEvent.click(rendered.getByText("Return to Chat"));
  fireEvent.click(rendered.getByText("Reply in Chat"));
  expect(context.onReturnToChat).toHaveBeenCalledOnce();
  expect(context.onReplyInChat).toHaveBeenCalledOnce();
  // Reply quotes the entry into that chat's composer.
  expect(useAgentViewStore.getState().replyQuote["host:agent"]?.text).toBe("Choose name");
  expect(navigateToAgent).not.toHaveBeenCalled();
  const foreign = { ...row, agentId: "another" };
  rendered.rerender(<GlobalStreamCard row={foreign} onSaved={vi.fn()} localContext={context} />);
  fireEvent.click(rendered.getByText("Reply in Chat"));
  expect(context.onReplyInChat).toHaveBeenCalledOnce();
  expect(useAgentViewStore.getState().replyQuote["host:another"]?.text).toBe("Choose name");
  expect(useAgentViewStore.getState().selectedViews["host:another"]).toBe("chat");
  expect(navigateToAgent).toHaveBeenCalledExactlyOnceWith({
    serverId: "host",
    agentId: "another",
    workspaceId: undefined,
  });
});

it("keeps local artifact preview, side opening and durable pinning", async () => {
  const context = {
    serverId: "host",
    agentId: "agent",
    cwd: "/project",
    artifactsSupported: true,
    onReturnToChat: vi.fn(),
    onReplyInChat: vi.fn(),
    onOpenWorkspaceFile: vi.fn(),
  };
  const artifact: GlobalStreamRow = {
    ...row,
    item: {
      kind: "artifact",
      artifact: {
        path: "/project/design.md",
        name: "design.md",
        kind: "markdown",
        mimeType: "text/markdown",
        size: 100,
        createdAt: row.timestamp,
        updatedAt: row.timestamp,
      },
    },
  };
  const saved = vi.fn();
  const rendered = render(
    <GlobalStreamCard row={artifact} onSaved={saved} localContext={context} />,
  );
  fireEvent.click(rendered.getByText("Preview file"));
  expect(context.onOpenWorkspaceFile).toHaveBeenCalledExactlyOnceWith({
    location: { path: "/project/design.md" },
    disposition: "side",
  });
  expect(context.onReturnToChat).toHaveBeenCalledOnce();
  expect(navigateToAgent).not.toHaveBeenCalled();
  state.updateStreamEntry.mockRejectedValueOnce(new Error("Pin save failed"));
  fireEvent.click(rendered.getByText("Pin file"));
  await waitFor(() =>
    expect(rendered.getByText("Pin save failed").textContent).toBe("Pin save failed"),
  );
  expect(saved).not.toHaveBeenCalled();
  fireEvent.click(rendered.getByText("Pin file"));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(state.updateStreamEntry.mock.calls[0][0].entryId).toBe(
    state.updateStreamEntry.mock.calls[1][0].entryId,
  );
  expect(state.updateStreamEntry).toHaveBeenLastCalledWith({
    agentId: "agent",
    entryId: expect.any(String),
    action: "add_pin",
    text: "Artifact: /project/design.md",
    sourceId: "artifact:/project/design.md",
  });
  rendered.rerender(
    <GlobalStreamCard
      row={artifact}
      onSaved={saved}
      localContext={{ ...context, artifactsSupported: false }}
    />,
  );
  expect(rendered.queryByText("Preview file")).toBeNull();
  expect(rendered.getByText("agentPanel.artifacts.updateHostDescription").textContent).toBe(
    "agentPanel.artifacts.updateHostDescription",
  );
});
