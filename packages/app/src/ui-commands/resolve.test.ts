import { describe, expect, it } from "vitest";
import { browserIdForUrl } from "@getpaseo/protocol/ui-browser-target";
import { resolveUiCommand, type ResolvedUiTabOpenCommand } from "./resolve";

function tabOpen(payload: Record<string, unknown>) {
  return resolveUiCommand({
    connectionServerId: "connection-server",
    payload: { command: "tab.open", ...payload } as Parameters<
      typeof resolveUiCommand
    >[0]["payload"],
  }) as ResolvedUiTabOpenCommand | null;
}

describe("resolveUiCommand", () => {
  it("resolves each tab kind the daemon can send", () => {
    expect(
      tabOpen({ workspaceId: "workspace-1", target: { kind: "agent", agentId: "agent-1" } }),
    ).toEqual({
      command: "tab.open",
      serverId: "connection-server",
      workspaceId: "workspace-1",
      target: { kind: "agent", agentId: "agent-1" },
      focus: true,
    });

    expect(
      tabOpen({
        workspaceId: "workspace-1",
        target: { kind: "terminal", terminalId: "terminal-1" },
      })?.target,
    ).toEqual({ kind: "terminal", terminalId: "terminal-1" });

    expect(
      tabOpen({
        workspaceId: "workspace-1",
        target: { kind: "file", path: "src/app.ts", lineStart: 12 },
      })?.target,
    ).toEqual({ kind: "file", path: "src/app.ts", lineStart: 12 });

    expect(
      tabOpen({ workspaceId: "workspace-1", target: { kind: "commit_diff", sha: "abc1234" } })
        ?.target,
    ).toEqual({ kind: "commit_diff", sha: "abc1234" });
  });

  it("turns a draft with no id into the sentinel the tab preparer expands", () => {
    expect(tabOpen({ workspaceId: "workspace-1", target: { kind: "draft" } })?.target).toEqual({
      kind: "draft",
      draftId: "new",
    });
    expect(
      tabOpen({ workspaceId: "workspace-1", target: { kind: "draft", draftId: "draft-7" } })
        ?.target,
    ).toEqual({ kind: "draft", draftId: "draft-7" });
  });

  it("prefers the serverId on the push over the connection it arrived on", () => {
    expect(
      tabOpen({
        serverId: "push-server",
        workspaceId: "workspace-1",
        target: { kind: "draft" },
      })?.serverId,
    ).toBe("push-server");
  });

  it("treats focus as opt-out", () => {
    expect(tabOpen({ workspaceId: "workspace-1", target: { kind: "draft" } })?.focus).toBe(true);
    expect(
      tabOpen({ workspaceId: "workspace-1", target: { kind: "draft" }, focus: false })?.focus,
    ).toBe(false);
  });

  it("resolves a tab.close command without a focus flag", () => {
    expect(
      resolveUiCommand({
        connectionServerId: "connection-server",
        payload: {
          command: "tab.close",
          workspaceId: "workspace-1",
          target: { kind: "agent", agentId: "agent-1" },
        },
      }),
    ).toEqual({
      command: "tab.close",
      serverId: "connection-server",
      workspaceId: "workspace-1",
      target: { kind: "agent", agentId: "agent-1" },
    });
  });

  it("drops a command with no resolvable server, workspace, or target", () => {
    expect(
      resolveUiCommand({
        connectionServerId: "  ",
        payload: {
          command: "tab.open",
          workspaceId: "workspace-1",
          target: { kind: "draft" },
        },
      }),
    ).toBeNull();
    expect(tabOpen({ workspaceId: "   ", target: { kind: "draft" } })).toBeNull();
    expect(
      tabOpen({ workspaceId: "workspace-1", target: { kind: "agent", agentId: " " } }),
    ).toBeNull();
  });

  it("carries side placement and resolves a page to its stable browser", () => {
    const resolved = tabOpen({
      workspaceId: "workspace-1",
      target: {
        kind: "browser",
        url: "https://m4-mini.tailb2a35c.ts.net:8047/general-checklist.html",
      },
      placement: "side",
      focus: false,
    });
    expect(resolved).toMatchObject({
      placement: "side",
      focus: false,
      browserUrl: "https://m4-mini.tailb2a35c.ts.net:8047/general-checklist.html",
      target: { kind: "browser" },
    });
    expect(resolved?.target.kind === "browser" && resolved.target.browserId).toBe(
      browserIdForUrl("https://m4-mini.tailb2a35c.ts.net:8047/general-checklist.html"),
    );
  });

  it("ignores a page URL that is not http(s)", () => {
    expect(
      tabOpen({
        workspaceId: "workspace-1",
        target: { kind: "browser", url: "javascript:alert(1)" },
      }),
    ).toBeNull();
  });
});
