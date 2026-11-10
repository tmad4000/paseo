import { beforeEach, expect, it, vi } from "vitest";
import { canOpenSessionWindow, openSessionLink } from "./session-link-runtime";
import { SessionLinkError } from "./session-link";
const fixture = vi.hoisted(() => ({
  supportsAgentWindow: true,
  known: true,
  online: true,
  cached: null as { id: string; workspaceId: string } | null,
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
          agentDetails: new Map(),
        },
      },
    }),
  },
}));
vi.mock("@/stores/workspace-layout-store", () => ({
  useWorkspaceLayoutStore: { getState: () => ({ ensureSidePane: fixture.side }) },
}));
vi.mock("@/stores/navigation-active-workspace-store", () => ({
  navigateToWorkspace: fixture.navigate,
}));
vi.mock("@/desktop/host", () => ({
  getDesktopHost: () => ({
    window: { openNew: fixture.window },
    agentNavigation: fixture.supportsAgentWindow ? { ready: vi.fn() } : undefined,
  }),
}));
const href = "paseo-fork://h/saved/agent/session";
beforeEach(() => {
  fixture.supportsAgentWindow = true;
  fixture.known = true;
  fixture.online = true;
  fixture.cached = null;
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
  fixture.cached = { id: "session", workspaceId: "moved-workspace" };
  await openSessionLink(href, "side");
  expect(fixture.fetchAgent).not.toHaveBeenCalled();
  expect(fixture.side).toHaveBeenCalledWith("saved:moved-workspace", { focus: true });
  expect(fixture.navigate).toHaveBeenCalledWith(
    expect.objectContaining({
      workspaceId: "moved-workspace",
      placement: { mode: "pane", paneId: "right" },
    }),
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
