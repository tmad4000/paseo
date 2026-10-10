import { describe, expect, it } from "vitest";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import type { WorkspaceFocusLocation } from "./focus-history";
import { describeFocusLocation, type FocusLocationLabelDeps } from "./focus-history-labels";

const deps: FocusLocationLabelDeps = {
  t: (key) => `t:${key}`,
  workspaceTitle: (_serverId, workspaceId) => (workspaceId === "ws-1" ? "Fork work" : null),
  agentTitle: (_serverId, agentId) => (agentId === "agent-1" ? "Fix the back button" : null),
};

function workspaceLocation(target: WorkspaceTabTarget | null): WorkspaceFocusLocation {
  return {
    kind: "workspace",
    serverId: "server-1",
    workspaceId: "ws-1",
    paneId: "main",
    tabId: "tab",
    target,
    view: { panel: "agent", explorerTab: "changes" },
  };
}

describe("focus history labels", () => {
  it("names the agent tab first and its workspace second", () => {
    expect(
      describeFocusLocation(workspaceLocation({ kind: "agent", agentId: "agent-1" }), deps),
    ).toEqual({ title: "Fix the back button", subtitle: "Fork work" });
  });

  it("falls back to the new-agent label for an untitled agent", () => {
    expect(
      describeFocusLocation(workspaceLocation({ kind: "agent", agentId: "agent-2" }), deps).title,
    ).toBe("t:shell.commandCenter.newAgent");
  });

  it("uses the file name for file tabs and the workspace alone without a tab", () => {
    expect(
      describeFocusLocation(workspaceLocation({ kind: "file", path: "src/app/main.ts" }), deps),
    ).toEqual({ title: "main.ts", subtitle: "Fork work" });
    expect(describeFocusLocation(workspaceLocation(null), deps)).toEqual({
      title: "Fork work",
      subtitle: null,
    });
  });

  it("names app pages and keeps unknown paths readable", () => {
    expect(describeFocusLocation({ kind: "route", pathname: "/settings/general" }, deps)).toEqual({
      title: "t:shell.recentWorkspaces.routes.settings",
      subtitle: null,
    });
    expect(describeFocusLocation({ kind: "route", pathname: "/elsewhere" }, deps).title).toBe(
      "/elsewhere",
    );
  });
});
