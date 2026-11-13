import { describe, expect, it, vi } from "vitest";
import {
  openSessionLinkWithPorts,
  SessionLinkError,
  sessionLinksInMessage,
  type SessionLinkPorts,
} from "./session-link";

const href = "paseo-fork://h/saved/agent/session";
function ports(): SessionLinkPorts {
  return {
    isKnownHost: (host) => host === "saved",
    resolveAgent: vi.fn(async () => ({ id: "session", workspaceId: "workspace" })),
    navigate: vi.fn(),
    openWindow: vi.fn(async () => undefined),
  };
}
describe("opening chat session links", () => {
  it.each(["current", "side", "window"] as const)(
    "verifies the target before opening %s",
    async (disposition) => {
      const deps = ports();
      await openSessionLinkWithPorts(href, disposition, deps);
      expect(deps.resolveAgent).toHaveBeenCalledWith({ serverId: "saved", agentId: "session" });
      if (disposition === "window") {
        expect(deps.openWindow).toHaveBeenCalledWith({ serverId: "saved", agentId: "session" });
        expect(deps.navigate).not.toHaveBeenCalled();
      } else
        expect(deps.navigate).toHaveBeenCalledWith(
          { serverId: "saved", agentId: "session", workspaceId: "workspace" },
          disposition,
        );
    },
  );
  it.each([
    "https://evil.example/h/saved/agent/session",
    "javascript:alert(1)",
    "paseo-fork://h/saved/agent/session?redirect=evil",
    "paseo-fork://h/saved/agent/%ZZ",
    "paseo-fork://user@h/saved/agent/session",
    "paseo-fork://evil/saved/agent/session",
    "paseo-fork://h/saved/agent/session#fragment",
  ])("rejects malformed or unrelated URL %s without any host request", async (url) => {
    const deps = ports();
    await expect(openSessionLinkWithPorts(url, "current", deps)).rejects.toEqual(
      new SessionLinkError("invalid"),
    );
    expect(deps.resolveAgent).not.toHaveBeenCalled();
    expect(deps.navigate).not.toHaveBeenCalled();
    expect(deps.openWindow).not.toHaveBeenCalled();
  });
  it("does not create a connection for an unknown host", async () => {
    const deps = ports();
    await expect(
      openSessionLinkWithPorts(href.replace("saved", "unknown"), "current", deps),
    ).rejects.toEqual(new SessionLinkError("unknownHost"));
    expect(deps.resolveAgent).not.toHaveBeenCalled();
  });
  it.each([null, { id: "other", workspaceId: "workspace" }, { id: "session", workspaceId: null }])(
    "rejects absent or mismatched agents",
    async (agent) => {
      const deps = ports();
      deps.resolveAgent = vi.fn(async () => agent);
      await expect(openSessionLinkWithPorts(href, "window", deps)).rejects.toEqual(
        new SessionLinkError("notFound"),
      );
      expect(deps.navigate).not.toHaveBeenCalled();
      expect(deps.openWindow).not.toHaveBeenCalled();
    },
  );
  it("rechecks host membership after a pending lookup", async () => {
    const deps = ports();
    let known = true;
    deps.isKnownHost = () => known;
    deps.resolveAgent = async () => {
      known = false;
      return { id: "session", workspaceId: "workspace" };
    };
    await expect(openSessionLinkWithPorts(href, "current", deps)).rejects.toEqual(
      new SessionLinkError("unknownHost"),
    );
    expect(deps.navigate).not.toHaveBeenCalled();
  });
  it("reports unavailable windows rather than silently doing nothing", async () => {
    const deps = ports();
    deps.openWindow = undefined;
    await expect(openSessionLinkWithPorts(href, "window", deps)).rejects.toEqual(
      new SessionLinkError("windowUnavailable"),
    );
    expect(deps.navigate).not.toHaveBeenCalled();
  });
  it("lists distinct message links for native menu actions, keeping the original URL", () => {
    const legacy = href.replace("paseo-fork:", "paseo:");
    expect(sessionLinksInMessage(`[First](${href}) [Again](${href}) [Legacy](${legacy})`)).toEqual([
      href,
      legacy,
    ]);
  });
});
