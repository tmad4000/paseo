import { describe, expect, it } from "vitest";
import { AgentNavigationInbox, parseAgentDeepLinkFromArgv } from "./agent-navigation.js";

describe("desktop agent navigation", () => {
  it("finds an agent deep link among Electron launch arguments", () => {
    expect(
      parseAgentDeepLinkFromArgv([
        "/Applications/Paseo.app/Contents/MacOS/Paseo",
        "--no-sandbox",
        "paseo://h/server-1/agent/agent-2",
      ]),
    ).toEqual({ serverId: "server-1", agentId: "agent-2" });
  });

  it("queues workspace/tab links through the same cold and warm window lifecycle", () => {
    const target = parseAgentDeepLinkFromArgv([
      "Paseo Fork",
      "paseo-fork://h/server-1/workspace/wks_1?open=terminal%3Aterm1",
    ]);
    expect(target).toEqual({ serverId: "server-1", workspaceId: "wks_1", open: "terminal:term1" });
    const inbox = new AgentNavigationInbox();
    expect(inbox.deliverOrQueue(9, target!)).toBeNull();
    expect(inbox.windowReady(9)).toEqual(target);
    expect(inbox.deliverOrQueue(9, target!)).toEqual(target);
    inbox.windowLoading(9);
    expect(inbox.deliverOrQueue(9, target!)).toBeNull();
    inbox.removeWindow(9);
    expect(inbox.windowReady(9)).toBeNull();
  });

  it("holds navigation until the existing renderer is ready", () => {
    const inbox = new AgentNavigationInbox();
    const target = { serverId: "server-1", agentId: "agent-2" };

    expect(inbox.deliverOrQueue(7, target)).toBeNull();
    expect(inbox.windowReady(7)).toEqual(target);
    expect(inbox.deliverOrQueue(7, target)).toEqual(target);
  });

  it("returns only the newest navigation queued during startup", () => {
    const inbox = new AgentNavigationInbox();

    inbox.deliverOrQueue(7, { serverId: "server-1", agentId: "agent-1" });
    inbox.deliverOrQueue(7, { serverId: "server-1", agentId: "agent-2" });

    expect(inbox.windowReady(7)).toEqual({ serverId: "server-1", agentId: "agent-2" });
    expect(inbox.windowReady(7)).toBeNull();
  });
});
