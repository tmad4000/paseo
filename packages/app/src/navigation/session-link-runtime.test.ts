import { beforeEach, expect, it, vi } from "vitest";
import { canOpenSessionWindow, openSessionLink } from "./session-link-runtime";
import { SessionLinkError } from "./session-link";
const fixture = vi.hoisted(() => ({
  supportsAgentWindow: true,
  sourcePane: "main",
  focusedPane: "main",
  sourceVisible: true,
  known: true,
  online: true,
  cached: null as { id: string; workspaceId: string | null } | null,
  detail: null as { id: string; workspaceId: string | null } | null,
  hydrated: true,
  workspaceKnown: true,
  fetchAgent: vi.fn(),
  navigate: vi.fn(),
  side: vi.fn(() => "right"),
  window: vi.fn(),
}));
vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({
    getHosts: () => (fixture.known ? [{ serverId: "saved" }] : []),
    getSnapshot: () => ({
      connectionStatus: fixture.online ? "online" : "offline",
      client: { fetchAgent: fixture.fetchAgent },
    }),
  }),
}));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: {
    getState: () => ({
      sessions: {
        saved: {
          agents: new Map(fixture.cached ? [["session", fixture.cached]] : []),
          agentDetails: new Map(fixture.detail ? [["session", fixture.detail]] : []),
          workspaces: new Map(fixture.workspaceKnown ? [["workspace", { id: "workspace" }]] : []),
        },
      },
    }),
  },
}));
vi.mock("@/stores/workspace-layout-store", () => ({
  useWorkspaceLayoutStore: {
    getState: () => ({
      ensureSidePane: fixture.side,
      sidePaneIdByWorkspace: { "saved:workspace": "right" },
      layoutByWorkspace: {
        "saved:workspace": {
          focusedPaneId: fixture.focusedPane,
          root: {
            kind: "pane",
            pane: {
              id: fixture.sourcePane,
              tabs: [{ tabId: "source" }],
              focusedTabId: fixture.sourceVisible ? "source" : "other",
            },
          },
        },
      },
    }),
    persist: { hasHydrated: () => fixture.hydrated },
  },
}));
vi.mock("@/stores/navigation-active-workspace-store", () => ({
  navigateToWorkspace: fixture.navigate,
}));
vi.mock("@/desktop/host", () => ({
  getDesktopHost: () => ({
    window: {
      openNew: fixture.window,
      supportsAgentTarget: fixture.supportsAgentWindow ? true : undefined,
    },
    agentNavigation: { ready: vi.fn() },
  }),
}));
const href = "paseo-fork://h/saved/agent/session";
const active = () => ({ serverId: "saved", workspaceId: "workspace", tabId: "source" });
beforeEach(() => {
  fixture.supportsAgentWindow = true;
  fixture.sourcePane = "main";
  fixture.focusedPane = "main";
  fixture.sourceVisible = true;
  fixture.known = true;
  fixture.online = true;
  fixture.cached = null;
  fixture.detail = null;
  fixture.hydrated = true;
  fixture.workspaceKnown = true;
  fixture.fetchAgent
    .mockReset()
    .mockResolvedValue({ agent: { id: "session", workspaceId: "workspace" } });
  fixture.navigate.mockReset();
  fixture.side.mockClear();
  fixture.window.mockReset();
});
it("opens a cold session using the target host's actual agent record", async () => {
  await openSessionLink(href);
  expect(fixture.fetchAgent).toHaveBeenCalledExactlyOnceWith({ agentId: "session" });
  expect(fixture.navigate).toHaveBeenCalledWith({
    serverId: "saved",
    workspaceId: "workspace",
    target: { kind: "agent", agentId: "session" },
    pin: true,
    placement: { mode: "focused" },
  });
});
it("opens an already known session beside without a host request", async () => {
  fixture.cached = { id: "session", workspaceId: "workspace" };
  await openSessionLink(href, "side", active);
  expect(fixture.fetchAgent).not.toHaveBeenCalled();
  expect(fixture.side).toHaveBeenCalledWith("saved:workspace", { focus: false });
  expect(fixture.navigate).toHaveBeenCalledWith(
    expect.objectContaining({
      workspaceId: "workspace",
      placement: { mode: "pane", paneId: "right" },
    }),
  );
});
it("rejects side opens across workspaces without changing the layout or route", async () => {
  await expect(
    openSessionLink(href, "side", () => ({
      serverId: "saved",
      workspaceId: "other",
      tabId: "source",
    })),
  ).rejects.toEqual(new SessionLinkError("sideUnavailable"));
  expect(fixture.side).not.toHaveBeenCalled();
  expect(fixture.navigate).not.toHaveBeenCalled();
});
it.each(["unhydrated layout", "unknown workspace"])(
  "rejects side opens with %s",
  async (condition) => {
    fixture.hydrated = condition !== "unhydrated layout";
    fixture.workspaceKnown = condition !== "unknown workspace";
    await expect(openSessionLink(href, "side", active)).rejects.toEqual(
      new SessionLinkError("sideUnavailable"),
    );
    expect(fixture.side).not.toHaveBeenCalled();
    expect(fixture.navigate).not.toHaveBeenCalled();
  },
);
it("checks detail when the list record lacks a workspace", async () => {
  fixture.cached = { id: "session", workspaceId: null };
  fixture.detail = { id: "session", workspaceId: "workspace" };
  await openSessionLink(href);
  expect(fixture.fetchAgent).not.toHaveBeenCalled();
  expect(fixture.navigate).toHaveBeenCalledWith(
    expect.objectContaining({ workspaceId: "workspace" }),
  );
});
it("fetches the exact agent when both cached records are unusable", async () => {
  fixture.cached = { id: "other", workspaceId: "workspace" };
  fixture.detail = { id: "session", workspaceId: " " };
  await openSessionLink(href);
  expect(fixture.fetchAgent).toHaveBeenCalledExactlyOnceWith({ agentId: "session" });
  expect(fixture.navigate).toHaveBeenCalledWith(
    expect.objectContaining({ workspaceId: "workspace" }),
  );
});
it("does not connect or fetch for unknown hosts", async () => {
  fixture.known = false;
  await expect(openSessionLink(href)).rejects.toEqual(new SessionLinkError("unknownHost"));
  expect(fixture.fetchAgent).not.toHaveBeenCalled();
  expect(fixture.navigate).not.toHaveBeenCalled();
});
it("reports an offline cold host without changing connections", async () => {
  fixture.online = false;
  await expect(openSessionLink(href)).rejects.toEqual(new SessionLinkError("unavailable"));
  expect(fixture.fetchAgent).not.toHaveBeenCalled();
  expect(fixture.navigate).not.toHaveBeenCalled();
});
it("never opens a window for a missing session", async () => {
  fixture.fetchAgent.mockResolvedValue({ agent: null });
  await expect(openSessionLink(href, "window")).rejects.toEqual(new SessionLinkError("notFound"));
  expect(fixture.window).not.toHaveBeenCalled();
});

it("does not advertise old new-window bridges that ignore agent targets", async () => {
  fixture.supportsAgentWindow = false;
  expect(canOpenSessionWindow()).toBe(false);
  await expect(openSessionLink(href, "window")).rejects.toEqual(
    new SessionLinkError("windowUnavailable"),
  );
  expect(fixture.window).not.toHaveBeenCalled();
});

it("dispatches the verified session target only through an explicitly supporting window bridge", async () => {
  expect(canOpenSessionWindow()).toBe(true);
  await openSessionLink(href, "window");
  expect(fixture.window).toHaveBeenCalledExactlyOnceWith({
    agent: { serverId: "saved", agentId: "session" },
  });
  expect(fixture.navigate).not.toHaveBeenCalled();
});
it.each(["right", "main"])(
  "does not replace a source in the side pane when global focus is %s",
  async (focusedPane) => {
    fixture.sourcePane = "right";
    fixture.focusedPane = focusedPane;
    await expect(openSessionLink(href, "side", active)).rejects.toEqual(
      new SessionLinkError("sideUnavailable"),
    );
    expect(fixture.side).not.toHaveBeenCalled();
    expect(fixture.navigate).not.toHaveBeenCalled();
  },
);
it("uses the source tab rather than unrelated global pane focus", async () => {
  fixture.focusedPane = "right";
  await openSessionLink(href, "side", active);
  expect(fixture.navigate).toHaveBeenCalledWith(
    expect.objectContaining({ placement: { mode: "pane", paneId: "right" } }),
  );
});
it("does not navigate beside a source that is no longer visible", async () => {
  fixture.sourceVisible = false;
  await expect(openSessionLink(href, "side", active)).rejects.toEqual(
    new SessionLinkError("sideUnavailable"),
  );
  expect(fixture.side).not.toHaveBeenCalled();
  expect(fixture.navigate).not.toHaveBeenCalled();
});
