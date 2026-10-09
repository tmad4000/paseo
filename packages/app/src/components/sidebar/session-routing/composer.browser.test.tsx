import { page } from "vitest/browser";
import type { DraftRecord, DraftInput } from "@/stores/draft-store/state";
import type { Theme } from "@/styles/theme";
import React, { act, useCallback, useState, useRef, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { within, waitFor } from "@testing-library/dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import { i18n } from "@/i18n/i18next";
import { useDraftStore } from "@/stores/draft-store";
import { AgentQueueDestinationChangedError } from "@getpaseo/client/internal/daemon-client";
import { flushQueueOutboxForServer, useQueueOutboxStore } from "@/stores/queue-outbox-store";
import { SESSION_ROUTING_DRAFT_KEY } from "@/stores/draft-keys";
import { SessionRoutingComposer } from "./composer";
import { searchExistingSessions } from "../../../../../server/src/server/session-search";
void i18n;
vi.mock("expo-router", () => ({
  router: {},
  useRouter: () => ({}),
  useLocalSearchParams: () => ({}),
  usePathname: () => "/fixture",
}));
vi.mock("react-native-unistyles", async () => {
  const { darkTheme } = await import("@/styles/theme");
  return {
    StyleSheet: {
      create: <T,>(styles: T | ((theme: Theme) => T)): T =>
        typeof styles === "function" ? Reflect.apply(styles, undefined, [darkTheme]) : styles,
    },
    withUnistyles: <T,>(component: T) => component,
    useUnistyles: () => ({ theme: darkTheme, rt: {}, breakpoint: undefined }),
    UnistylesRuntime: { themeName: "dark", setTheme: () => {} },
  };
});
const fixture = vi.hoisted(() => ({
  pauseEffects: false,
  effects: [] as Array<{ run: () => void | (() => void); cleanup?: () => void; active: boolean }>,
  serverIds: ["host"],
  directory: true,
  routingSupported: true as boolean | null,
  query: "Where were we working on offline?",
  changeQuery: (_query: string) => {},
  search: vi.fn(),
  enqueue: vi.fn(),
  open: vi.fn(),
  placement: {
    serverId: "host",
    workspaceId: "workspace",
    projectViewKey: "view",
    projectName: "Paseo",
    name: "paseo",
  },
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useEffect: (effect: () => void | (() => void), dependencies?: readonly unknown[]) =>
      actual.useEffect(() => {
        if (!fixture.pauseEffects) return effect();
        const deferred = {
          run: effect,
          active: true,
          cleanup: undefined as (() => void) | undefined,
        };
        fixture.effects.push(deferred);
        return () => {
          deferred.active = false;
          deferred.cleanup?.();
        };
        // This interceptor forwards the caller's dependencies to preserve effect scheduling.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, dependencies),
  };
});
vi.mock("@/components/sidebar/sidebar-model", () => ({
  useSidebarModel: () => ({
    searchQuery: fixture.query,
    setSearchQuery: fixture.changeQuery,
    serverIds: fixture.serverIds,
    hostRegistryLoaded: true,
    allProjects: [{ viewKey: "view", projectName: "Paseo" }],
    workspacePlacements: fixture.directory ? [fixture.placement] : [],
  }),
}));
vi.mock("@/runtime/host-runtime", () => ({
  useHosts: () => [{ serverId: "host", label: "M5" }],
  getHostRuntimeStore: () => ({
    getClient: () => ({
      getConnectionState: () => ({ status: "connected" }),
      getLastServerInfoMessage: () =>
        fixture.routingSupported === null
          ? null
          : {
              features: { sessionSearch: fixture.routingSupported, agentMessageQueue: true },
            },
      searchSessions: fixture.search,
      enqueueAgentMessage: fixture.enqueue,
    }),
  }),
}));
vi.mock("@/stores/navigation-active-workspace-store", () => ({
  navigateToWorkspace: fixture.open,
  useActiveWorkspaceSelection: () => ({ serverId: "host", workspaceId: "workspace" }),
}));
vi.mock("@/utils/navigate-to-agent", () => ({ navigateToAgent: fixture.open }));
vi.mock("@/stores/session-store", async () => {
  const { create } = await import("zustand");
  return {
    selectAgentTurnPresentation: () => ({ isActive: false, turnId: null }),
    useSessionStore: create(() => ({
      sessions: {
        host: {
          hasHydratedWorkspaces: true,
          agents: new Map([
            [
              "chat",
              {
                id: "chat",
                serverId: "host",
                workspaceId: "workspace",
                title: "Offline indicator",
              },
            ],
          ]),
          workspaces: new Map([["workspace", { projectId: "project" }]]),
          serverInfo: { features: { sessionSearch: true, agentMessageQueue: true } },
        },
      },
      applyAgentQueueSnapshot: vi.fn(),
    })),
  };
});
vi.mock("@/stores/draft-store", async () => {
  const { create } = await import("zustand");
  const { persist } = await import("zustand/middleware");
  const { editDraftRecordText } = await import("@/stores/draft-store/state");
  const storage = (await import("@react-native-async-storage/async-storage")).default;
  const { createJSONStorage } = await import("zustand/middleware");
  interface FixtureDraftState {
    drafts: Record<string, DraftRecord>;
    editDraftText: (input: { draftKey: string; text: string }) => void;
    saveDraftInput: (input: { draftKey: string; draft: DraftInput }) => void;
    getDraftInput: (key: string) => DraftInput | undefined;
    hydrateDraftInput: (input: { draftKey: string }) => Promise<DraftInput | undefined>;
  }
  const fixtureDraftStore = create<FixtureDraftState>()(
    persist(
      (set, get) => ({
        drafts: {},
        editDraftText: ({ draftKey, text }) =>
          set((state) => ({
            drafts: {
              ...state.drafts,
              [draftKey]: editDraftRecordText(state.drafts[draftKey], text, Date.now()),
            },
          })),
        saveDraftInput: ({ draftKey, draft }) =>
          get().editDraftText({ draftKey, text: draft.text }),
        getDraftInput: (key) =>
          get().drafts[key]?.lifecycle === "active" ? get().drafts[key].input : undefined,
        hydrateDraftInput: async ({ draftKey }) => get().getDraftInput(draftKey),
      }),
      { name: "routing-fixture-drafts", storage: createJSONStorage(() => storage) },
    ),
  );
  return {
    useDraftStore: fixtureDraftStore,
    flushDraftPersistStorage: async () => {},
    flushDraftPersistStorageDurably: async () => {},
    awaitDraftHydration: async () => {
      if (!fixtureDraftStore.persist.hasHydrated()) await fixtureDraftStore.persist.rehydrate();
      if (!fixtureDraftStore.persist.hasHydrated()) throw new Error("Draft hydration failed");
    },
  };
});
let root: Root | undefined;
let container: HTMLDivElement;
let queryClient: QueryClient;
const result = {
  agentId: "chat",
  workspaceId: "workspace",
  projectId: "project",
  projectName: "Paseo",
  title: "Offline indicator",
  excerpt: "Relay reconnect investigation",
  confidence: 0.98,
};
beforeEach(async () => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fixture.pauseEffects = false;
  fixture.effects.length = 0;
  fixture.search.mockReset();
  fixture.enqueue.mockReset();
  fixture.open.mockReset();
  fixture.serverIds = ["host"];
  fixture.directory = true;
  fixture.routingSupported = true;
  queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  fixture.query = "Where were we working on offline?";
  fixture.search.mockResolvedValue({ results: [result], searchedCount: 1, totalCount: 1 });
  fixture.enqueue.mockResolvedValue({ agentId: "chat", revision: 1, items: [] });
  await useDraftStore.persist.rehydrate();
  await useQueueOutboxStore.persist.rehydrate();
  useDraftStore.setState({
    drafts: {},
    hydrateDraftInput: async ({ draftKey }) => useDraftStore.getState().getDraftInput(draftKey),
  });
  useQueueOutboxStore.setState({ entries: {}, acknowledgements: {}, rejections: {} });
  document.body.style.background = "#141716";
  container = document.createElement("div");
  container.style.width = "320px";
  container.style.padding = "12px";
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});
const fixtureFindStyle = { color: "#f2f3f2", fontSize: 14 };
function Fixture() {
  const [query, setQuery] = useState(fixture.query);
  fixture.changeQuery = setQuery;
  fixture.query = query;
  const inputRef = useRef<EditingTextInputHandle>(null);
  useEffect(() => {
    if (!query && inputRef.current?.getText()) inputRef.current.reset();
  }, [query]);
  const renderInput = useCallback(
    (submit: () => void) => (
      <EditingTextInput
        ref={inputRef}
        style={fixtureFindStyle}
        accessibilityLabel="Find query"
        initialValue={query}
        onChangeText={setQuery}
        onSubmitEditing={submit}
      />
    ),
    [query],
  );
  return <SessionRoutingComposer>{renderInput}</SessionRoutingComposer>;
}
async function render() {
  await act(async () =>
    root?.render(
      <QueryClientProvider client={queryClient}>
        <Fixture />
      </QueryClientProvider>,
    ),
  );
  return within(container);
}
async function mount() {
  await render();
  await waitFor(() =>
    expect(within(container).getByTestId("routing-submit").getAttribute("aria-disabled")).not.toBe(
      "true",
    ),
  );
  return within(container);
}
function type(input: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const prototype =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (!setter) throw new Error("No input setter");
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
  });
}
test("Find and Open never deliver; Use restores independent draft and explicit send waits for acknowledgement", async () => {
  useDraftStore
    .getState()
    .editDraftText({ draftKey: SESSION_ROUTING_DRAFT_KEY, text: "  fix the relay\n" });
  const view = await mount();
  act(() => view.getByTestId("routing-submit").click());
  await waitFor(() => expect(view.getByText("Relay reconnect investigation")).toBeTruthy());
  expect(fixture.enqueue).not.toHaveBeenCalled();
  act(() => view.getByRole("button", { name: "Open chat" }).click());
  expect(fixture.open).toHaveBeenCalled();
  expect(fixture.enqueue).not.toHaveBeenCalled();
  act(() => view.getByRole("button", { name: "Use this chat" }).click());
  expect(view.getByTestId<HTMLInputElement>("routing-send-draft").value).toBe("  fix the relay\n");
  expect(fixture.enqueue).not.toHaveBeenCalled();
  let acknowledge!: (value: { agentId: string; revision: number; items: [] }) => void;
  fixture.enqueue.mockImplementation(
    () =>
      new Promise((resolve) => {
        acknowledge = resolve;
      }),
  );
  act(() => {
    view.getByTestId("routing-submit").click();
    view.getByTestId("routing-submit").click();
  });
  await waitFor(() => expect(fixture.enqueue).toHaveBeenCalledTimes(1));
  expect(fixture.search).toHaveBeenCalledTimes(1);
  expect(fixture.enqueue.mock.calls[0]?.[0]).toMatchObject({
    agentId: "chat",
    text: "  fix the relay\n",
    expectedWorkspaceId: "workspace",
  });
  expect(view.queryByText("Routed to Paseo · Offline indicator")).toBeNull();
  await act(async () => acknowledge({ agentId: "chat", revision: 1, items: [] }));
  await waitFor(() => expect(view.getByText("Routed to Paseo · Offline indicator")).toBeTruthy());
});
test("ambiguous send asks first and query edits retain previous Find results", async () => {
  const view = await mount();
  act(() => view.getByTestId("routing-submit").click());
  await waitFor(() => expect(view.getByText("Relay reconnect investigation")).toBeTruthy());
  type(view.getByRole<HTMLInputElement>("textbox", { name: "Find query" }), "different query");
  await waitFor(() => expect(view.getByText("Relay reconnect investigation")).toBeTruthy());
  expect(view.getByText("Results from previous text. Find again to refresh.")).toBeTruthy();
  fixture.search.mockResolvedValue({
    results: [
      result,
      { ...result, agentId: "other", title: "Relay diagnostics", confidence: 0.93 },
    ],
    searchedCount: 2,
    totalCount: 2,
  });
  act(() => view.getByTestId("routing-send-mode").click());
  type(view.getByTestId<HTMLTextAreaElement>("routing-send-draft"), "continue");
  act(() => view.getByTestId("routing-submit").click());
  await waitFor(() => expect(view.getAllByRole("button", { name: "Queue here" })).toHaveLength(2));
  expect(fixture.enqueue).not.toHaveBeenCalled();
  act(() => view.getAllByRole("button", { name: "Queue here" })[0]?.click());
  await waitFor(() => expect(fixture.enqueue).toHaveBeenCalledTimes(1));
});

test("Route to best match queues a clear winner and Move draft reopens the chooser with the draft", async () => {
  const view = await mount();
  act(() => view.getByTestId("routing-send-mode").click());
  type(view.getByTestId<HTMLTextAreaElement>("routing-send-draft"), "continue the offline work");
  // The route verb must queue even when a direct delivery mode is selected.
  act(() => view.getByTestId("routing-delivery-steer").click());
  act(() => view.getByTestId("routing-route-best").click());
  await waitFor(() => expect(fixture.enqueue).toHaveBeenCalledTimes(1));
  expect(fixture.search).toHaveBeenCalledTimes(1);
  expect(fixture.enqueue.mock.calls[0]?.[0]).toMatchObject({
    agentId: "chat",
    text: "continue the offline work",
    expectedWorkspaceId: "workspace",
  });
  await waitFor(() => expect(view.getByText("Routed to Paseo · Offline indicator")).toBeTruthy());
  await waitFor(() =>
    expect(view.getByTestId<HTMLTextAreaElement>("routing-send-draft").value).toBe(""),
  );
  act(() => view.getByRole("button", { name: "Wrong chat? Move draft" }).click());
  await waitFor(() =>
    expect(view.getByTestId<HTMLTextAreaElement>("routing-send-draft").value).toBe(
      "continue the offline work",
    ),
  );
  // The manual chooser reopened; nothing was delivered a second time.
  expect(view.getByRole("button", { name: "Find a chat" })).toBeTruthy();
  expect(fixture.enqueue).toHaveBeenCalledTimes(1);
});

test("Route to best match without a decisive winner presents candidates and preserves the draft", async () => {
  fixture.search.mockResolvedValue({
    results: [
      result,
      { ...result, agentId: "other", title: "Relay diagnostics", confidence: 0.93 },
    ],
    searchedCount: 2,
    totalCount: 2,
  });
  const view = await mount();
  act(() => view.getByTestId("routing-send-mode").click());
  type(view.getByTestId<HTMLTextAreaElement>("routing-send-draft"), "continue");
  act(() => view.getByTestId("routing-route-best").click());
  await waitFor(() => expect(view.getAllByRole("button", { name: "Queue here" })).toHaveLength(2));
  expect(
    view.getByText("No clear best match. Choose the destination; nothing sent yet."),
  ).toBeTruthy();
  expect(fixture.enqueue).not.toHaveBeenCalled();
  expect(view.getByTestId<HTMLTextAreaElement>("routing-send-draft").value).toBe("continue");
});

test("Route to best match with no match offers a new conversation with the draft", async () => {
  fixture.search.mockResolvedValue({ results: [], searchedCount: 1, totalCount: 1 });
  const view = await mount();
  act(() => view.getByTestId("routing-send-mode").click());
  type(view.getByTestId<HTMLTextAreaElement>("routing-send-draft"), "brand new idea");
  act(() => view.getByTestId("routing-route-best").click());
  await waitFor(() =>
    expect(
      view.getByRole("button", { name: "Start a new conversation with this draft" }),
    ).toBeTruthy(),
  );
  expect(fixture.enqueue).not.toHaveBeenCalled();
  act(() => view.getByRole("button", { name: "Start a new conversation with this draft" }).click());
  expect(view.getByTestId("routing-recipient").textContent).toContain("New conversation");
  expect(view.getByTestId<HTMLTextAreaElement>("routing-send-draft").value).toBe("brand new idea");
  expect(fixture.enqueue).not.toHaveBeenCalled();
});

test("Find renders queued recording evidence with local dates without sending", async () => {
  fixture.query = "Where were we discussing recording on Notestream Vision?";
  const timestamp = "2026-10-04T19:38:08.993Z";
  const text = "Start recording on Notestream Vision";
  fixture.search.mockImplementation(async () =>
    searchExistingSessions({
      query: fixture.query,
      workspaceIds: ["workspace"],
      candidates: [
        {
          agentId: "chat",
          workspaceId: "workspace",
          projectId: "project",
          projectName: "tmpworkspace",
          title: "Recording discussion",
          cwd: "/fixture",
          updatedAt: timestamp,
          excerpts: [{ text, source: "queued_message", timestamp }],
        },
      ],
      readContext: async () => [],
      generate: async () => ({ matches: [{ agentId: "chat", confidence: 0.98, excerptIndex: 0 }] }),
    }),
  );
  const view = await mount();
  act(() => view.getByTestId("routing-submit").click());
  await waitFor(() => expect(view.getByText(text).textContent).toBe(text));
  const localTime = new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(timestamp));
  expect(view.getByText(`Queued message · ${localTime}`).textContent).toBe(
    `Queued message · ${localTime}`,
  );
  expect(view.getByText(`Updated ${localTime}`).textContent).toBe(`Updated ${localTime}`);
  expect(view.getByText("tmpworkspace · M5").textContent).toBe("tmpworkspace · M5");
  expect(fixture.enqueue).not.toHaveBeenCalled();
  await page.viewport(900, 640);
  await page.screenshot({ element: container });
  await page.viewport(390, 700);
  await page.screenshot({ element: container });
  act(() => view.getByRole("button", { name: "Open chat" }).click());
  expect(fixture.open).toHaveBeenCalledTimes(1);
  expect(fixture.enqueue).not.toHaveBeenCalled();
});

test("rendered desktop and compact fixture evidence", async () => {
  const view = await mount();
  await page.viewport(900, 640);
  act(() => view.getByTestId("routing-submit").click());
  await waitFor(() => expect(view.getByText("Relay reconnect investigation")).toBeTruthy());
  await page.screenshot({
    element: container,
    path: "../../../../.vitest-screenshots/routing-find-desktop.png",
  });
  act(() => view.getByRole("button", { name: "Use this chat" }).click());
  type(
    view.getByTestId<HTMLTextAreaElement>("routing-send-draft"),
    "Fix the offline indicator when the relay reconnects.",
  );
  await page.viewport(390, 700);
  await page.screenshot({
    element: container,
    path: "../../../../.vitest-screenshots/routing-send-compact.png",
  });
});

test("no match and incomplete coverage preserve the prompt and require manual choice", async () => {
  fixture.search.mockResolvedValue({ results: [], searchedCount: 1, totalCount: 1 });
  const view = await mount();
  act(() => view.getByTestId("routing-send-mode").click());
  type(view.getByTestId<HTMLTextAreaElement>("routing-send-draft"), "do the task");
  act(() => view.getByTestId("routing-submit").click());
  await waitFor(() =>
    expect(view.getByRole("button", { name: "Choose an existing chat" })).toBeTruthy(),
  );
  expect(fixture.enqueue).not.toHaveBeenCalled();
  expect(view.getByTestId<HTMLTextAreaElement>("routing-send-draft").value).toBe("do the task");
  fixture.search.mockResolvedValue({ results: [result], searchedCount: 100, totalCount: 150 });
  act(() => view.getByTestId("routing-submit").click());
  await waitFor(() => expect(view.getByRole("button", { name: "Queue here" })).toBeTruthy());
  expect(fixture.enqueue).not.toHaveBeenCalled();
});
test("an old failed Find cannot override a newer lookup", async () => {
  let fail!: (error: Error) => void;
  fixture.search.mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        fail = reject;
      }),
  );
  const view = await mount();
  act(() => view.getByTestId("routing-submit").click());
  await waitFor(() => expect(fixture.search).toHaveBeenCalledTimes(1));
  type(view.getByRole<HTMLInputElement>("textbox", { name: "Find query" }), "new lookup");
  act(() => view.getByTestId("routing-submit").click());
  await waitFor(() => expect(view.getByText("Relay reconnect investigation")).toBeTruthy());
  await act(async () => fail(new Error("stale failure")));
  expect(view.queryByText("stale failure")).toBeNull();
  expect(fixture.enqueue).not.toHaveBeenCalled();
});

test("complete Find displays searched and total chat counts", async () => {
  fixture.search.mockResolvedValue({ results: [result], searchedCount: 12, totalCount: 12 });
  const view = await mount();
  act(() => view.getByTestId("routing-submit").click());
  await waitFor(() =>
    expect(view.getByText("Searched 12 of 12 chats.").textContent).toBe("Searched 12 of 12 chats."),
  );
  expect(fixture.enqueue).not.toHaveBeenCalled();
});

test("a selected host without a directory prevents automatic delivery", async () => {
  fixture.serverIds = ["host", "cold-host"];
  const view = await mount();
  act(() => view.getByTestId("routing-send-mode").click());
  type(view.getByTestId<HTMLTextAreaElement>("routing-send-draft"), "continue");
  act(() => view.getByTestId("routing-submit").click());
  await waitFor(() => expect(view.getAllByRole("button", { name: "Queue here" })).toHaveLength(1));
  expect(view.getByText(/Host directories are still loading/).textContent).toContain(
    "Choose a chat manually.",
  );
  expect(fixture.search).toHaveBeenCalledTimes(1);
  expect(fixture.enqueue).not.toHaveBeenCalled();
  expect(view.getByTestId<HTMLTextAreaElement>("routing-send-draft").value).toBe("continue");
});

test("a pushed acknowledgement survives a lost enqueue response", async () => {
  fixture.enqueue.mockImplementation(async (entry) => {
    const outbox = useQueueOutboxStore.getState();
    await outbox.acknowledge(entry.itemId, {
      agentId: "chat",
      revision: 1,
      items: [{ id: entry.itemId, text: entry.text, createdAt: "2026-01-01T00:00:00.000Z" }],
    });
    await outbox.removeDurably(entry.itemId, true);
    throw new Error("response lost");
  });
  const view = await mount();
  act(() => view.getByTestId("routing-send-mode").click());
  type(view.getByTestId<HTMLTextAreaElement>("routing-send-draft"), "continue");
  act(() => view.getByTestId("routing-submit").click());
  await waitFor(() => expect(view.getByRole("button", { name: "Queue here" })).toBeTruthy());
  act(() => view.getByRole("button", { name: "Queue here" }).click());
  await waitFor(() =>
    expect(view.getByText("Queued for Paseo · Offline indicator").textContent).toBe(
      "Queued for Paseo · Offline indicator",
    ),
  );
  expect(view.queryByText("response lost")).toBeNull();
  await waitFor(() =>
    expect(view.getByTestId<HTMLTextAreaElement>("routing-send-draft").value).toBe(""),
  );
  act(() => view.getByTestId("routing-submit").click());
  expect(fixture.enqueue).toHaveBeenCalledTimes(1);
});

test("changing selected hosts ignores an in-flight automatic send and clears editable recipients", async () => {
  let resolve!: (value: {
    results: (typeof result)[];
    searchedCount: number;
    totalCount: number;
  }) => void;
  fixture.search.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const view = await mount();
  act(() => view.getByTestId("routing-send-mode").click());
  type(view.getByTestId<HTMLTextAreaElement>("routing-send-draft"), "continue");
  act(() => view.getByTestId("routing-submit").click());
  await waitFor(() => expect(fixture.search).toHaveBeenCalledTimes(1));
  fixture.serverIds = ["cold-host"];
  await render();
  await act(async () => resolve({ results: [result], searchedCount: 1, totalCount: 1 }));
  expect(fixture.enqueue).not.toHaveBeenCalled();
  expect(view.queryByText("Relay reconnect investigation")).toBeNull();
  expect(view.getByTestId<HTMLTextAreaElement>("routing-send-draft").value).toBe("continue");
  fixture.serverIds = ["host"];
  await render();
  act(() => view.getByTestId("routing-find-mode").click());
  act(() => view.getByTestId("routing-submit").click());
  await waitFor(() => expect(view.getByRole("button", { name: "Use this chat" })).toBeTruthy());
  act(() => view.getByRole("button", { name: "Use this chat" }).click());
  fixture.serverIds = ["cold-host"];
  await render();
  expect(view.getByTestId("routing-recipient").textContent).toContain("Find a chat");
});

test("host changes ignore stale Find failure and success", async () => {
  let reject!: (error: Error) => void;
  fixture.search.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  const view = await mount();
  act(() => view.getByTestId("routing-submit").click());
  await waitFor(() => expect(fixture.search).toHaveBeenCalledTimes(1));
  fixture.serverIds = ["cold-host"];
  await render();
  await act(async () => reject(new Error("old host failure")));
  expect(view.queryByText(/old host failure/)).toBeNull();
  expect(fixture.enqueue).not.toHaveBeenCalled();
});

test("filtering out an uncertain destination preserves its lock and original retry ID", async () => {
  fixture.enqueue.mockRejectedValueOnce(new Error("response lost"));
  const view = await mount();
  act(() => view.getByTestId("routing-send-mode").click());
  type(view.getByTestId<HTMLTextAreaElement>("routing-send-draft"), "continue");
  act(() => view.getByTestId("routing-submit").click());
  await waitFor(() => expect(view.getByRole("button", { name: "Queue here" })).toBeTruthy());
  act(() => view.getByRole("button", { name: "Queue here" }).click());
  await waitFor(() => expect(view.getByRole("button", { name: "Retry delivery" })).toBeTruthy());
  const itemId = fixture.enqueue.mock.calls[0]?.[0].itemId;
  fixture.serverIds = ["cold-host"];
  await render();
  expect(view.getByTestId("routing-submit").getAttribute("aria-disabled")).toBe("true");
  act(() => view.getByRole("button", { name: "Retry delivery" }).click());
  expect(fixture.enqueue).toHaveBeenCalledTimes(1);
  fixture.serverIds = ["host"];
  await render();
  act(() => view.getByRole("button", { name: "Retry delivery" }).click());
  await waitFor(() => expect(fixture.enqueue).toHaveBeenCalledTimes(2));
  expect(fixture.enqueue.mock.calls[1]?.[0].itemId).toBe(itemId);
});

test("both persisted reads gate sending and restore an owned pending item with no loaded directory", async () => {
  useDraftStore.getState().editDraftText({ draftKey: SESSION_ROUTING_DRAFT_KEY, text: "continue" });
  const record = useDraftStore.getState().drafts[SESSION_ROUTING_DRAFT_KEY];
  await useQueueOutboxStore.getState().add({
    serverId: "host",
    agentId: "chat",
    itemId: "recovered-original",
    text: "continue",
    expectedWorkspaceId: "workspace",
    expectedProjectId: "project",
    routingOrigin: true,
    routingDraftVersion: record?.version,
    routingDraftUpdatedAt: record?.updatedAt,
    images: [],
    attachments: [],
    composerAttachments: [],
  });
  const draftStorage = useDraftStore.persist.getOptions().storage!;
  const outboxStorage = useQueueOutboxStore.persist.getOptions().storage!;
  let releaseDraft!: () => void;
  let releaseOutbox!: () => void;
  const draftRead = new Promise<void>((done) => {
    releaseDraft = done;
  });
  const outboxRead = new Promise<void>((done) => {
    releaseOutbox = done;
  });
  useDraftStore.persist.setOptions({
    storage: {
      ...draftStorage,
      getItem: async (key) => {
        await draftRead;
        return draftStorage.getItem(key);
      },
    },
  });
  useQueueOutboxStore.persist.setOptions({
    storage: {
      ...outboxStorage,
      getItem: async (key) => {
        await outboxRead;
        return outboxStorage.getItem(key);
      },
    },
  });
  const loadingDraft = useDraftStore.persist.rehydrate();
  const loadingOutbox = useQueueOutboxStore.persist.rehydrate();
  fixture.directory = false;
  try {
    const view = await render();
    expect(view.getByTestId("routing-submit").getAttribute("aria-disabled")).toBe("true");
    await act(async () => releaseDraft());
    await loadingDraft;
    expect(view.getByTestId("routing-submit").getAttribute("aria-disabled")).toBe("true");
    await act(async () => releaseOutbox());
    await loadingOutbox;
    await waitFor(() => expect(view.getByRole("button", { name: "Retry delivery" })).toBeTruthy());
    expect(view.getByTestId("routing-submit").getAttribute("aria-disabled")).toBe("true");
    expect(view.getByTestId<HTMLTextAreaElement>("routing-send-draft").value).toBe("continue");
    expect(fixture.search).not.toHaveBeenCalled();
    act(() => view.getByRole("button", { name: "Retry delivery" }).click());
    await waitFor(() => expect(fixture.enqueue).toHaveBeenCalledTimes(1));
    expect(fixture.enqueue.mock.calls[0]?.[0].itemId).toBe("recovered-original");
  } finally {
    releaseDraft();
    releaseOutbox();
    useDraftStore.persist.setOptions({ storage: draftStorage });
    useQueueOutboxStore.persist.setOptions({ storage: outboxStorage });
  }
});

for (const newer of [false, true]) {
  test(`persisted tentative clear restores offline Retry and preserves newer ownership: ${newer}`, async () => {
    const key = SESSION_ROUTING_DRAFT_KEY;
    useDraftStore.getState().editDraftText({ draftKey: key, text: "continue" });
    const record = useDraftStore.getState().drafts[key]!;
    await useQueueOutboxStore.getState().add({
      serverId: "host",
      agentId: "chat",
      itemId: "tentative-original",
      text: "continue",
      expectedWorkspaceId: "original-workspace",
      expectedProjectId: "original-project",
      routingOrigin: true,
      routingDraftVersion: record.version,
      routingDraftUpdatedAt: record.updatedAt,
      images: [],
      attachments: [],
      composerAttachments: [],
    });
    const { editDraftRecordText } = await import("@/stores/draft-store/state");
    const cleared = editDraftRecordText(record, "", record.updatedAt + 1, true);
    const saved = newer
      ? { ...cleared, input: { text: "continue", attachments: [] } }
      : {
          ...cleared,
          routingClear: {
            itemId: "tentative-original",
            version: cleared.version,
            updatedAt: cleared.updatedAt,
          },
        };
    const draftStorage = useDraftStore.persist.getOptions().storage!;
    await draftStorage.setItem("routing-fixture-drafts", {
      state: { drafts: { [key]: saved } },
      version: 0,
    });
    await useDraftStore.persist.rehydrate();
    await useQueueOutboxStore.persist.rehydrate();
    fixture.directory = false;
    fixture.enqueue.mockRejectedValue(new Error("host offline"));
    const view = await render();
    if (newer) {
      act(() => view.getByTestId("routing-send-mode").click());
      await waitFor(() =>
        expect(view.getByTestId<HTMLTextAreaElement>("routing-send-draft").value).toBe("continue"),
      );
      expect(view.queryByRole("button", { name: "Retry delivery" })).toBeNull();
      expect(useDraftStore.getState().drafts[key]).toEqual(saved);
    } else {
      await waitFor(() =>
        expect(view.getByRole("button", { name: "Retry delivery" })).toBeTruthy(),
      );
      expect(view.getByTestId("routing-submit").getAttribute("aria-disabled")).toBe("true");
      expect(view.getByTestId<HTMLTextAreaElement>("routing-send-draft").value).toBe("continue");
      act(() => view.getByRole("button", { name: "Retry delivery" }).click());
      await waitFor(() => expect(fixture.enqueue).toHaveBeenCalledTimes(1));
      expect(fixture.enqueue.mock.calls[0]?.[0]).toMatchObject({
        itemId: "tentative-original",
        agentId: "chat",
        text: "continue",
        expectedWorkspaceId: "original-workspace",
        expectedProjectId: "original-project",
      });
      expect(view.getByTestId("routing-submit").getAttribute("aria-disabled")).toBe("true");
    }
    expect(fixture.search).not.toHaveBeenCalled();
  });
}

test("an acknowledgement during draft loading cannot pair stale text with new ownership", async () => {
  useDraftStore.getState().editDraftText({ draftKey: SESSION_ROUTING_DRAFT_KEY, text: "continue" });
  const record = useDraftStore.getState().drafts[SESSION_ROUTING_DRAFT_KEY];
  await useQueueOutboxStore.getState().add({
    serverId: "host",
    agentId: "chat",
    itemId: "accepted-on-load",
    text: "continue",
    routingOrigin: true,
    routingDraftVersion: record?.version,
    routingDraftUpdatedAt: record?.updatedAt,
    images: [],
    attachments: [],
    composerAttachments: [],
  });
  let finishMigration!: () => void;
  const migration = new Promise<void>((done) => {
    finishMigration = done;
  });
  const staleInput = useDraftStore.getState().getDraftInput(SESSION_ROUTING_DRAFT_KEY);
  useDraftStore.setState({
    hydrateDraftInput: async () => {
      await migration;
      return staleInput;
    },
  });
  const view = await render();
  await act(async () => {
    await useQueueOutboxStore
      .getState()
      .acknowledge("accepted-on-load", { agentId: "chat", revision: 1, items: [] });
    await useQueueOutboxStore.getState().removeDurably("accepted-on-load");
    finishMigration();
  });
  await waitFor(() =>
    expect(view.getByTestId("routing-send-mode").getAttribute("aria-disabled")).not.toBe("true"),
  );
  act(() => view.getByTestId("routing-send-mode").click());
  expect(view.getByTestId<HTMLTextAreaElement>("routing-send-draft").value).toBe("");
  act(() => view.getByTestId("routing-submit").click());
  expect(fixture.enqueue).not.toHaveBeenCalled();
});

test("visible Find and Send actions have matching voice-accessible names", async () => {
  const view = await mount();
  expect(view.getByRole("button", { name: "Find existing chats" }).textContent).toContain("Find");
  act(() => view.getByRole("button", { name: "Send prompt mode" }).click());
  expect(view.getByRole("button", { name: "Find first" }).textContent).toBe("Find first");
  for (const mode of ["queue", "steer", "interrupt"])
    expect(view.getByTestId(`routing-delivery-${mode}`)).toBeTruthy();
});

for (const outcome of ["acknowledged", "rejected"] as const) {
  test(`host exclusion clears the editable pin after pending delivery is ${outcome}`, async () => {
    const view = await mount();
    act(() => view.getByTestId("routing-submit").click());
    await waitFor(() => expect(view.getByRole("button", { name: "Use this chat" })).toBeTruthy());
    act(() => view.getByRole("button", { name: "Use this chat" }).click());
    type(view.getByTestId<HTMLTextAreaElement>("routing-send-draft"), "continue");
    fixture.enqueue.mockRejectedValueOnce(new Error("lost response"));
    act(() => view.getByTestId("routing-submit").click());
    await waitFor(() => expect(view.getByRole("button", { name: "Retry delivery" })).toBeTruthy());
    const itemId = fixture.enqueue.mock.calls[0]?.[0].itemId;
    fixture.serverIds = ["cold-host"];
    await render();
    expect(view.getByTestId("routing-recipient").textContent).toContain("Find a chat");
    expect(view.getByRole("button", { name: "Retry delivery" })).toBeTruthy();
    await act(async () => {
      if (outcome === "acknowledged") {
        await useQueueOutboxStore
          .getState()
          .acknowledge(itemId, { agentId: "chat", revision: 2, items: [] });
        await useQueueOutboxStore.getState().removeDurably(itemId);
      } else {
        await flushQueueOutboxForServer({
          serverId: "host",
          client: {
            getLastServerInfoMessage: () => ({
              features: { sessionSearch: true, agentMessageQueue: true },
            }),
            enqueueAgentMessage: async () => {
              throw new AgentQueueDestinationChangedError();
            },
          },
          applySnapshot: () => {},
        });
      }
    });
    await waitFor(() => expect(view.queryByRole("button", { name: "Retry delivery" })).toBeNull());
    expect(view.getByTestId("routing-recipient").textContent).toContain("Find a chat");
    fixture.serverIds = ["host"];
    await render();
    act(() => view.getByTestId("routing-recipient").click());
    act(() => view.getByRole("button", { name: /Paseo.*Offline indicator/ }).click());
    type(view.getByTestId<HTMLTextAreaElement>("routing-send-draft"), "next prompt");
    act(() => view.getByTestId("routing-submit").click());
    await waitFor(() => expect(fixture.enqueue).toHaveBeenCalledTimes(2));
    expect(fixture.enqueue.mock.calls[1]?.[0].text).toBe("next prompt");
  });
}

test("cold recovery never adopts a moved chat's new project for retry", async () => {
  useDraftStore.getState().editDraftText({ draftKey: SESSION_ROUTING_DRAFT_KEY, text: "continue" });
  const record = useDraftStore.getState().drafts[SESSION_ROUTING_DRAFT_KEY];
  await useQueueOutboxStore.getState().add({
    serverId: "host",
    agentId: "chat",
    itemId: "moved-original",
    text: "continue",
    expectedWorkspaceId: "original-workspace",
    expectedProjectId: "original-project",
    routingOrigin: true,
    routingDraftVersion: record?.version,
    routingDraftUpdatedAt: record?.updatedAt,
    images: [],
    attachments: [],
    composerAttachments: [],
  });
  await useDraftStore.persist.rehydrate();
  await useQueueOutboxStore.persist.rehydrate();
  fixture.enqueue.mockImplementation(async (entry) => {
    if (entry.expectedWorkspaceId !== "workspace" || entry.expectedProjectId !== "project")
      throw new AgentQueueDestinationChangedError();
    return { agentId: "chat", revision: 1, items: [] };
  });
  const view = await render();
  await waitFor(() => expect(view.getByRole("button", { name: "Retry delivery" })).toBeTruthy());
  expect(view.getByTestId("routing-recipient").textContent).toContain("original-project");
  act(() => view.getByRole("button", { name: "Retry delivery" }).click());
  await waitFor(() => expect(fixture.enqueue).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(useQueueOutboxStore.getState().entries["moved-original"]).toBeUndefined(),
  );
  expect(fixture.enqueue.mock.calls[0]?.[0]).toMatchObject({
    itemId: "moved-original",
    expectedWorkspaceId: "original-workspace",
    expectedProjectId: "original-project",
  });
  expect(useQueueOutboxStore.getState().entries["moved-original"]).toBeUndefined();
  expect(view.getByTestId<HTMLTextAreaElement>("routing-send-draft").value).toBe("continue");
});

for (const capability of [false, null] as const) {
  test(`host capability ${capability} during durable acceptance cannot submit to a downgraded connection`, async () => {
    const view = await mount();
    act(() => view.getByTestId("routing-send-mode").click());
    type(view.getByTestId<HTMLTextAreaElement>("routing-send-draft"), "continue");
    const storage = (await import("@react-native-async-storage/async-storage")).default;
    const setItem = storage.setItem.bind(storage);
    let release!: () => void;
    const hold = new Promise<void>((done) => {
      release = done;
    });
    let saving = false;
    const spy = vi.spyOn(storage, "setItem").mockImplementation(async (key, value) => {
      if (key === "paseo-queue-outbox") {
        saving = true;
        await hold;
      }
      return setItem(key, value);
    });
    try {
      act(() => view.getByTestId("routing-submit").click());
      await waitFor(() => expect(view.getByRole("button", { name: "Queue here" })).toBeTruthy());
      act(() => view.getByRole("button", { name: "Queue here" }).click());
      await waitFor(() => expect(saving).toBe(true));
      fixture.routingSupported = capability;
      await act(async () => release());
      await waitFor(() =>
        expect(view.getByTestId("routing-submit").getAttribute("aria-disabled")).not.toBe("true"),
      );
      expect(fixture.enqueue).not.toHaveBeenCalled();
      expect(view.getByTestId<HTMLTextAreaElement>("routing-send-draft").value).toBe("continue");
      expect(Object.values(useQueueOutboxStore.getState().entries)).toEqual([]);
    } finally {
      release();
      spy.mockRestore();
    }
  });
}

test("host exclusion during durable outbox acceptance releases an unsent draft safely", async () => {
  const view = await mount();
  act(() => view.getByTestId("routing-send-mode").click());
  type(view.getByTestId<HTMLTextAreaElement>("routing-send-draft"), "continue");
  const storage = (await import("@react-native-async-storage/async-storage")).default;
  const setItem = storage.setItem.bind(storage);
  let release!: () => void;
  const hold = new Promise<void>((done) => {
    release = done;
  });
  let saving = false;
  const spy = vi.spyOn(storage, "setItem").mockImplementation(async (key, value) => {
    if (key === "paseo-queue-outbox") {
      saving = true;
      await hold;
    }
    return setItem(key, value);
  });
  try {
    act(() => view.getByTestId("routing-submit").click());
    await waitFor(() => expect(view.getByRole("button", { name: "Queue here" })).toBeTruthy());
    act(() => view.getByRole("button", { name: "Queue here" }).click());
    await waitFor(() => expect(saving).toBe(true));
    fixture.serverIds = ["cold-host"];
    await render();
    expect(view.getByTestId("routing-submit").getAttribute("aria-disabled")).toBe("true");
    await flushQueueOutboxForServer({
      serverId: "host",
      client: {
        getLastServerInfoMessage: () => ({
          features: { sessionSearch: true, agentMessageQueue: true },
        }),
        enqueueAgentMessage: fixture.enqueue,
      },
      applySnapshot: () => {},
    });
    expect(fixture.enqueue).not.toHaveBeenCalled();
    await act(async () => release());
    await waitFor(() =>
      expect(view.getByTestId("routing-submit").getAttribute("aria-disabled")).not.toBe("true"),
    );
    expect(view.getByTestId<HTMLTextAreaElement>("routing-send-draft").value).toBe("continue");
    expect(Object.values(useQueueOutboxStore.getState().entries)).toEqual([]);
    await flushQueueOutboxForServer({
      serverId: "host",
      client: {
        getLastServerInfoMessage: () => ({
          features: { sessionSearch: true, agentMessageQueue: true },
        }),
        enqueueAgentMessage: fixture.enqueue,
      },
      applySnapshot: () => {},
    });
    expect(fixture.enqueue).not.toHaveBeenCalled();
  } finally {
    release();
    spy.mockRestore();
  }
});

for (const rejection of ["direct", "reconnect"] as const) {
  test(`${rejection} definitive rejection keeps the draft locked when durable removal fails`, async () => {
    const view = await mount();
    act(() => view.getByTestId("routing-send-mode").click());
    type(view.getByTestId<HTMLTextAreaElement>("routing-send-draft"), "continue");
    let ownedId = "";
    fixture.enqueue.mockImplementation(async (entry) => {
      ownedId = entry.itemId;
      if (rejection === "reconnect") throw new Error("response lost");
      throw new AgentQueueDestinationChangedError();
    });
    const storage = (await import("@react-native-async-storage/async-storage")).default;
    const setItem = storage.setItem.bind(storage);
    const spy = vi.spyOn(storage, "setItem").mockImplementation(async (key, value) => {
      if (key === "paseo-queue-outbox" && ownedId && !JSON.parse(value).state.entries[ownedId])
        throw new Error("durable removal failed");
      return setItem(key, value);
    });
    try {
      act(() => view.getByTestId("routing-submit").click());
      await waitFor(() => expect(view.getByRole("button", { name: "Queue here" })).toBeTruthy());
      act(() => view.getByRole("button", { name: "Queue here" }).click());
      await waitFor(() =>
        expect(view.getByRole("button", { name: "Retry delivery" })).toBeTruthy(),
      );
      if (rejection === "reconnect") {
        fixture.enqueue.mockRejectedValue(new AgentQueueDestinationChangedError());
        await act(async () => {
          await expect(
            flushQueueOutboxForServer({
              serverId: "host",
              client: {
                getLastServerInfoMessage: () => ({
                  features: { sessionSearch: true, agentMessageQueue: true },
                }),
                enqueueAgentMessage: fixture.enqueue,
              },
              applySnapshot: () => {},
            }),
          ).rejects.toThrow("durable removal failed");
        });
      }
      expect(useQueueOutboxStore.getState().entries[ownedId]).toBeTruthy();
      expect(useQueueOutboxStore.getState().rejections[ownedId]).toBeUndefined();
      expect(view.getByTestId("routing-submit").getAttribute("aria-disabled")).toBe("true");
      expect(view.getByTestId<HTMLTextAreaElement>("routing-send-draft").value).toBe("continue");
      await act(async () => {
        await useQueueOutboxStore.persist.rehydrate();
        await useDraftStore.persist.rehydrate();
        root?.unmount();
        root = createRoot(container);
      });
      await render();
      await waitFor(() =>
        expect(view.getByRole("button", { name: "Retry delivery" })).toBeTruthy(),
      );
      expect(view.getByTestId("routing-submit").getAttribute("aria-disabled")).toBe("true");
      expect(useQueueOutboxStore.getState().entries[ownedId]).toMatchObject({
        itemId: ownedId,
        text: "continue",
      });
      spy.mockRestore();
      fixture.enqueue.mockRejectedValue(new AgentQueueDestinationChangedError());
      act(() => view.getByRole("button", { name: "Retry delivery" }).click());
      await waitFor(() => expect(useQueueOutboxStore.getState().entries[ownedId]).toBeUndefined());
      await waitFor(() =>
        expect(view.getByTestId("routing-submit").getAttribute("aria-disabled")).not.toBe("true"),
      );
      expect(view.getByTestId<HTMLTextAreaElement>("routing-send-draft").value).toBe("continue");
      expect(fixture.enqueue.mock.calls.every(([entry]) => entry.itemId === ownedId)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
}

test("Find remains independent of an externally revised Send draft", async () => {
  let resolve!: (value: {
    results: (typeof result)[];
    searchedCount: number;
    totalCount: number;
  }) => void;
  fixture.search.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const view = await mount();
  act(() => view.getByTestId("routing-submit").click());
  await waitFor(() => expect(fixture.search).toHaveBeenCalledTimes(1));
  act(() => {
    useDraftStore
      .getState()
      .editDraftText({ draftKey: SESSION_ROUTING_DRAFT_KEY, text: "separate send draft" });
  });
  await act(async () =>
    resolve({
      results: [{ ...result, excerpt: "current Find evidence" }],
      searchedCount: 1,
      totalCount: 1,
    }),
  );
  await waitFor(() => expect(view.getByText("current Find evidence")).toBeTruthy());
  expect(view.getByTestId("routing-submit").getAttribute("aria-disabled")).not.toBe("true");
  expect(fixture.enqueue).not.toHaveBeenCalled();
});

test("automatic Send remains independent of the Find query", async () => {
  let resolve!: (value: {
    results: (typeof result)[];
    searchedCount: number;
    totalCount: number;
  }) => void;
  fixture.search.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const view = await mount();
  act(() => view.getByTestId("routing-send-mode").click());
  type(view.getByTestId<HTMLTextAreaElement>("routing-send-draft"), "  continue\n");
  act(() => view.getByTestId("routing-submit").click());
  await waitFor(() => expect(fixture.search).toHaveBeenCalledTimes(1));
  act(() => {
    fixture.changeQuery("unrelated Find query");
  });
  await act(async () => resolve({ results: [result], searchedCount: 1, totalCount: 1 }));
  await waitFor(() => expect(view.getByRole("button", { name: "Queue here" })).toBeTruthy());
  expect(fixture.enqueue).not.toHaveBeenCalled();
  act(() => view.getByRole("button", { name: "Queue here" }).click());
  await waitFor(() => expect(fixture.enqueue).toHaveBeenCalledTimes(1));
  expect(fixture.enqueue.mock.calls[0][0].text).toBe("  continue\n");
});

for (const outcome of ["success", "failure"] as const) {
  test(`canceling an old lookup releases loading and preserves the newer lookup after ${outcome}`, async () => {
    const lookups: {
      resolve: (value: {
        results: (typeof result)[];
        searchedCount: number;
        totalCount: number;
      }) => void;
      reject: (error: Error) => void;
    }[] = [];
    fixture.search.mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          lookups.push({ resolve, reject });
        }),
    );
    const view = await mount();
    act(() => view.getByTestId("routing-submit").click());
    await waitFor(() => expect(lookups).toHaveLength(1));
    fixture.pauseEffects = true;
    type(view.getByRole<HTMLTextAreaElement>("textbox", { name: "Find query" }), "new Find query");
    await waitFor(() =>
      expect(view.getByTestId("routing-submit").getAttribute("aria-disabled")).not.toBe("true"),
    );
    act(() => view.getByTestId("routing-submit").click());
    await waitFor(() => expect(lookups).toHaveLength(2));
    fixture.pauseEffects = false;
    act(() => {
      for (const effect of fixture.effects.splice(0))
        if (effect.active) effect.cleanup = effect.run() ?? undefined;
    });
    await act(async () => {
      if (outcome === "success")
        lookups[0].resolve({
          results: [{ ...result, excerpt: "old evidence" }],
          searchedCount: 1,
          totalCount: 1,
        });
      else lookups[0].reject(new Error("old error"));
    });
    expect(view.getByTestId("routing-submit").getAttribute("aria-disabled")).toBe("true");
    expect(view.queryByText("old evidence")).toBeNull();
    expect(view.queryByText(/old error/)).toBeNull();
    await act(async () =>
      lookups[1].resolve({
        results: [{ ...result, excerpt: "new evidence" }],
        searchedCount: 1,
        totalCount: 1,
      }),
    );
    await waitFor(() => expect(view.getByText("new evidence")).toBeTruthy());
    expect(view.getByTestId("routing-submit").getAttribute("aria-disabled")).not.toBe("true");
    expect(fixture.enqueue).not.toHaveBeenCalled();
  });
}

for (const change of ["mode", "query", "scope", "draft", "revision"] as const) {
  for (const outcome of ["success", "failure"] as const) {
    test(`${change} changes invalidate matching ${outcome} before passive cancellation runs`, async () => {
      let resolve!: (value: {
        results: (typeof result)[];
        searchedCount: number;
        totalCount: number;
      }) => void;
      let reject!: (error: Error) => void;
      fixture.search.mockImplementation(
        () =>
          new Promise((done, fail) => {
            resolve = done;
            reject = fail;
          }),
      );
      const view = await mount();
      const sending = change === "mode" || change === "draft" || change === "revision";
      if (sending) {
        act(() => view.getByTestId("routing-send-mode").click());
        type(view.getByTestId<HTMLTextAreaElement>("routing-send-draft"), "continue");
      }
      act(() => view.getByTestId("routing-submit").click());
      await waitFor(() => expect(fixture.search).toHaveBeenCalledTimes(1));
      if (change === "scope") {
        act(() => view.getByTestId("routing-scope").click());
        await waitFor(() =>
          expect(within(document.body).getByText("Current project · Paseo")).toBeTruthy(),
        );
      }
      fixture.pauseEffects = true;
      if (change === "mode") act(() => view.getByTestId("routing-find-mode").click());
      else if (change === "query")
        type(
          view.getByRole<HTMLTextAreaElement>("textbox", { name: "Find query" }),
          "different query",
        );
      else if (change === "scope")
        act(() => within(document.body).getByText("Current project · Paseo").click());
      else if (change === "draft")
        type(view.getByTestId<HTMLTextAreaElement>("routing-send-draft"), "new draft");
      else
        act(() => {
          useDraftStore
            .getState()
            .editDraftText({ draftKey: SESSION_ROUTING_DRAFT_KEY, text: "temporary" });
          useDraftStore
            .getState()
            .editDraftText({ draftKey: SESSION_ROUTING_DRAFT_KEY, text: "continue" });
        });
      await act(async () => {
        if (outcome === "success")
          resolve({
            results: [{ ...result, excerpt: "stale match evidence" }],
            searchedCount: 1,
            totalCount: 1,
          });
        else reject(new Error("stale matching failure"));
      });
      expect(fixture.enqueue).not.toHaveBeenCalled();
      expect(view.queryByText("stale match evidence")).toBeNull();
      expect(view.queryByText(/stale matching failure/)).toBeNull();
      expect(view.queryByText(/The submitted draft changed/)).toBeNull();
      expect(view.getByTestId("routing-submit").getAttribute("aria-disabled")).not.toBe("true");
      if (sending)
        expect(useDraftStore.getState().getDraftInput(SESSION_ROUTING_DRAFT_KEY)?.text).toBe(
          change === "draft" ? "new draft" : "continue",
        );
    });
  }
}

test("ordinary queue cancellation resolves routing pending without a success receipt", async () => {
  const view = await mount();
  act(() => view.getByTestId("routing-submit").click());
  await waitFor(() => expect(view.getByRole("button", { name: "Use this chat" })).toBeTruthy());
  act(() => view.getByRole("button", { name: "Use this chat" }).click());
  type(view.getByTestId<HTMLTextAreaElement>("routing-send-draft"), "continue");
  fixture.enqueue.mockRejectedValueOnce(new Error("lost response"));
  act(() => view.getByTestId("routing-submit").click());
  await waitFor(() => expect(view.getByRole("button", { name: "Retry delivery" })).toBeTruthy());
  const itemId = fixture.enqueue.mock.calls[0]![0].itemId;
  await act(async () => {
    const store = useQueueOutboxStore.getState();
    await store.requestRemoval(store.entries[itemId]!);
    await flushQueueOutboxForServer({
      serverId: "host",
      client: {
        enqueueAgentMessage: fixture.enqueue,
        removeQueuedAgentMessage: async () => ({ agentId: "chat", revision: 2, items: [] }),
      },
      applySnapshot: () => {},
    });
  });
  await waitFor(() => expect(view.queryByRole("button", { name: "Retry delivery" })).toBeNull());
  expect(container.textContent).toContain("removed from the queue");
  expect(container.textContent).not.toContain("Routed to");
  expect(container.textContent).not.toContain("Queued for");
  expect(fixture.enqueue).toHaveBeenCalledTimes(1);
  expect(view.getByTestId<HTMLTextAreaElement>("routing-send-draft").value).toBe("continue");
});

test("cold cancellation ownership locks Send without a recipient directory until durable removal", async () => {
  useDraftStore.getState().editDraftText({ draftKey: SESSION_ROUTING_DRAFT_KEY, text: "continue" });
  const record = useDraftStore.getState().drafts[SESSION_ROUTING_DRAFT_KEY]!;
  await useQueueOutboxStore.getState().add({
    serverId: "host",
    agentId: "chat",
    itemId: "cold-cancel",
    text: "continue",
    expectedWorkspaceId: "workspace",
    expectedProjectId: "project",
    routingOrigin: true,
    routingDispatchHeld: true,
    routingDraftVersion: record.version,
    routingDraftUpdatedAt: record.updatedAt,
    images: [],
    attachments: [],
    composerAttachments: [],
  });
  await useQueueOutboxStore
    .getState()
    .requestRemoval(useQueueOutboxStore.getState().entries["cold-cancel"]!);
  await useQueueOutboxStore.persist.rehydrate();
  fixture.directory = false;
  fixture.routingSupported = false;
  const view = await render();
  await waitFor(() => expect(view.getByRole("button", { name: "Retry delivery" })).toBeTruthy());
  expect(view.getByTestId("routing-submit").getAttribute("aria-disabled")).toBe("true");
  act(() => view.getByRole("button", { name: "Retry delivery" }).click());
  await waitFor(() => expect(view.getByRole("button", { name: "Retry delivery" })).toBeTruthy());
  expect(fixture.enqueue).not.toHaveBeenCalled();
  await act(async () => {
    await flushQueueOutboxForServer({
      serverId: "host",
      client: {
        enqueueAgentMessage: fixture.enqueue,
        removeQueuedAgentMessage: async () => ({ agentId: "chat", revision: 2, items: [] }),
      },
      applySnapshot: () => {},
    });
  });
  await waitFor(() => expect(view.queryByRole("button", { name: "Retry delivery" })).toBeNull());
  expect(container.textContent).toContain("removed from the queue");
  expect(container.textContent).not.toContain("Routed to");
  expect(container.textContent).not.toContain("Queued for");
  expect(view.getByTestId<HTMLTextAreaElement>("routing-send-draft").value).toBe("continue");
  expect(fixture.enqueue).not.toHaveBeenCalled();
});

test("a durable cancellation intent supersedes an acknowledgement waiting for the composer", async () => {
  const view = await mount();
  act(() => view.getByTestId("routing-submit").click());
  await waitFor(() => expect(view.getByRole("button", { name: "Use this chat" })).toBeTruthy());
  act(() => view.getByRole("button", { name: "Use this chat" }).click());
  type(view.getByTestId<HTMLTextAreaElement>("routing-send-draft"), "continue");
  fixture.enqueue.mockRejectedValueOnce(new Error("lost response"));
  act(() => view.getByTestId("routing-submit").click());
  await waitFor(() => expect(view.getByRole("button", { name: "Retry delivery" })).toBeTruthy());
  const itemId = fixture.enqueue.mock.calls[0]![0].itemId;
  fixture.pauseEffects = true;
  await act(async () => {
    const store = useQueueOutboxStore.getState();
    await store.acknowledge(itemId, { agentId: "chat", revision: 2, items: [] });
    await store.requestRemoval(store.entries[itemId]!);
  });
  fixture.pauseEffects = false;
  await act(async () => {
    for (const effect of fixture.effects.splice(0))
      if (effect.active) effect.cleanup = effect.run() ?? undefined;
  });
  expect(view.getByRole("button", { name: "Retry delivery" })).toBeTruthy();
  expect(container.textContent).not.toContain("Routed to");
  expect(container.textContent).not.toContain("Queued for");
});

test("cold suppressed acknowledgement ownership permits only the original delivery Retry", async () => {
  useDraftStore.getState().editDraftText({ draftKey: SESSION_ROUTING_DRAFT_KEY, text: "continue" });
  const record = useDraftStore.getState().drafts[SESSION_ROUTING_DRAFT_KEY]!;
  const store = useQueueOutboxStore.getState();
  await store.add({
    serverId: "host",
    agentId: "chat",
    itemId: "suppressed-original",
    text: "continue",
    expectedWorkspaceId: "workspace",
    expectedProjectId: "project",
    routingOrigin: true,
    routingDraftVersion: record.version,
    routingDraftUpdatedAt: record.updatedAt,
    images: [],
    attachments: [],
    composerAttachments: [],
  });
  await store.removeDurably("suppressed-original", true);
  await useQueueOutboxStore.persist.rehydrate();
  await useDraftStore.persist.rehydrate();
  fixture.directory = false;
  const view = await render();
  await waitFor(() => expect(view.getByRole("button", { name: "Retry delivery" })).toBeTruthy());
  expect(view.getByTestId("routing-submit").getAttribute("aria-disabled")).toBe("true");
  expect(
    view.getByTestId<HTMLTextAreaElement>("routing-send-draft").getAttribute("readonly"),
  ).not.toBeNull();
  expect(fixture.enqueue).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain("Routed to");
  expect(container.textContent).not.toContain("removed from the queue");
  act(() => view.getByRole("button", { name: "Retry delivery" }).click());
  await waitFor(() => expect(fixture.enqueue).toHaveBeenCalledTimes(1));
  expect(fixture.enqueue.mock.calls[0]![0]).toMatchObject({
    itemId: "suppressed-original",
    text: "continue",
  });
  await waitFor(() => expect(view.queryByRole("button", { name: "Retry delivery" })).toBeNull());
});

test("Find first never auto-sends, retains choices during edits, and queues only the newest explicit prompt", async () => {
  const view = await mount();
  act(() => view.getByTestId("routing-send-mode").click());
  type(view.getByTestId<HTMLTextAreaElement>("routing-send-draft"), "first prompt");
  expect(view.getByTestId("routing-submit").textContent).toBe("Find first");
  act(() => view.getByTestId("routing-submit").click());
  await waitFor(() => expect(view.getByRole("button", { name: "Queue here" })).toBeTruthy());
  expect(fixture.enqueue).not.toHaveBeenCalled();
  act(() => view.getByTestId("routing-delivery-steer").click());
  expect(view.getByRole("button", { name: "Steer here" })).toBeTruthy();
  act(() => view.getByTestId("routing-delivery-interrupt").click());
  expect(view.getByRole("button", { name: "Interrupt here" })).toBeTruthy();
  act(() => view.getByTestId("routing-delivery-queue").click());
  type(view.getByTestId<HTMLTextAreaElement>("routing-send-draft"), "  newest prompt\n");
  expect(view.getByText("Relay reconnect investigation")).toBeTruthy();
  expect(view.getByText("Results from previous text. Find again to refresh.")).toBeTruthy();
  expect(fixture.search).toHaveBeenCalledTimes(1);
  act(() => view.getByRole("button", { name: "Queue here" }).click());
  await waitFor(() => expect(fixture.enqueue).toHaveBeenCalledTimes(1));
  expect(fixture.enqueue.mock.calls[0][0].text).toBe("  newest prompt\n");
});

test("explicit Clear resets the visible Find input and results while preserving the separate Send draft", async () => {
  useDraftStore
    .getState()
    .editDraftText({ draftKey: SESSION_ROUTING_DRAFT_KEY, text: "keep send draft" });
  const view = await mount();
  act(() => view.getByTestId("routing-submit").click());
  await waitFor(() => expect(view.getByText("Relay reconnect investigation")).toBeTruthy());
  act(() => view.getByRole("button", { name: "Clear search" }).click());
  expect(view.getByRole<HTMLInputElement>("textbox", { name: "Find query" }).value).toBe("");
  expect(view.queryByText("Relay reconnect investigation")).toBeNull();
  act(() => view.getByTestId("routing-send-mode").click());
  expect(view.getByTestId<HTMLTextAreaElement>("routing-send-draft").value).toBe("keep send draft");
  act(() => view.getByRole("button", { name: "Clear prompt" }).click());
  expect(view.getByTestId<HTMLTextAreaElement>("routing-send-draft").value).toBe("");
  expect(useDraftStore.getState().getDraftInput(SESSION_ROUTING_DRAFT_KEY)?.text ?? "").toBe("");
  expect(fixture.enqueue).not.toHaveBeenCalled();
});

test("delivery options are visible and explicit recipient actions name the selected mode", async () => {
  const view = await mount();
  act(() => view.getByTestId("routing-submit").click());
  await waitFor(() => expect(view.getByRole("button", { name: "Use this chat" })).toBeTruthy());
  act(() => view.getByRole("button", { name: "Use this chat" }).click());
  type(view.getByTestId<HTMLTextAreaElement>("routing-send-draft"), "draft");
  for (const mode of ["queue", "steer", "interrupt"] as const) {
    act(() => view.getByTestId(`routing-delivery-${mode}`).click());
    expect(view.getByTestId("routing-submit").textContent?.toLowerCase()).toBe(mode);
  }
  expect(fixture.enqueue).not.toHaveBeenCalled();
});

test("Clear can dismiss retained candidates after the prompt is manually emptied", async () => {
  const view = await mount();
  act(() => view.getByTestId("routing-send-mode").click());
  type(view.getByTestId<HTMLTextAreaElement>("routing-send-draft"), "find a destination");
  act(() => view.getByTestId("routing-submit").click());
  await waitFor(() => expect(view.getByRole("button", { name: "Queue here" })).toBeTruthy());
  type(view.getByTestId<HTMLTextAreaElement>("routing-send-draft"), "");
  expect(view.getByRole("button", { name: "Queue here" }).getAttribute("aria-disabled")).toBe(
    "true",
  );
  expect(view.getByRole("button", { name: "Clear prompt" }).getAttribute("aria-disabled")).not.toBe(
    "true",
  );
  act(() => view.getByRole("button", { name: "Clear prompt" }).click());
  expect(view.queryByText("Relay reconnect investigation")).toBeNull();
  expect(fixture.enqueue).not.toHaveBeenCalled();
});

test("an explicitly selected recipient receives the latest prompt when editing and submitting in one render batch", async () => {
  const view = await mount();
  act(() => view.getByTestId("routing-submit").click());
  await waitFor(() => expect(view.getByRole("button", { name: "Use this chat" })).toBeTruthy());
  act(() => view.getByRole("button", { name: "Use this chat" }).click());
  const input = view.getByTestId<HTMLTextAreaElement>("routing-send-draft");
  type(input, "old prompt");
  act(() => {
    type(input, "same-tick latest prompt");
    view.getByTestId("routing-submit").click();
  });
  await waitFor(() => expect(fixture.enqueue).toHaveBeenCalledTimes(1));
  expect(fixture.enqueue.mock.calls[0][0].text).toBe("same-tick latest prompt");
});

test("new conversation stores the prompt under the existing workspace draft-tab key before navigation", async () => {
  const view = await mount();
  act(() => view.getByTestId("routing-scope").click());
  await waitFor(() =>
    expect(within(document.body).getByText("Current project · Paseo")).toBeTruthy(),
  );
  act(() => within(document.body).getByText("Current project · Paseo").click());
  act(() => view.getByTestId("routing-send-mode").click());
  const text = "  A new task\nwith preserved whitespace.  ";
  type(view.getByTestId<HTMLTextAreaElement>("routing-send-draft"), text);
  act(() => view.getByTestId("routing-new-conversation").click());
  await waitFor(() =>
    expect(view.getByTestId("routing-new-workspace").textContent).toContain("Paseo"),
  );
  act(() => view.getByTestId("routing-submit").click());
  await waitFor(() => expect(fixture.open).toHaveBeenCalledTimes(1));
  const destination = fixture.open.mock.calls[0][0];
  expect(destination).toMatchObject({
    serverId: "host",
    workspaceId: "workspace",
    target: { kind: "draft" },
  });
  expect(
    useDraftStore.getState().getDraftInput(`draft:host:${destination.target.draftId}`)?.text,
  ).toBe(text);
  expect(fixture.enqueue).not.toHaveBeenCalled();
  expect(fixture.search).not.toHaveBeenCalled();
});
