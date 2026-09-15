import { describe, expect, test } from "vitest";
import {
  normalizeUiWorkspaceTabTarget,
  resolveUiTabCloseCommand,
  resolveUiTabOpenCommand,
} from "./ui-commands.js";

function deps(knownWorkspaceIds: string[] = ["workspace-1"]) {
  return {
    serverId: "daemon-server",
    workspaceExists: async (workspaceId: string) => knownWorkspaceIds.includes(workspaceId),
  };
}

describe("resolveUiTabCloseCommand", () => {
  test("builds a tab.close push for a known workspace", async () => {
    const result = await resolveUiTabCloseCommand(
      { workspaceId: "workspace-1", target: { kind: "agent", agentId: "agent-1" } },
      deps(),
    );

    expect(result).toEqual({
      ok: true,
      serverId: "daemon-server",
      workspaceId: "workspace-1",
      command: {
        type: "ui.command",
        payload: {
          command: "tab.close",
          serverId: "daemon-server",
          workspaceId: "workspace-1",
          target: { kind: "agent", agentId: "agent-1" },
        },
      },
    });
  });

  test("rejects an unknown workspace", async () => {
    const result = await resolveUiTabCloseCommand(
      { workspaceId: "workspace-9", target: { kind: "draft" } },
      deps(),
    );
    expect(result).toMatchObject({ ok: false, error: "Workspace not found: workspace-9" });
  });
});

describe("resolveUiTabOpenCommand", () => {
  test("builds a tab.open push for a known workspace", async () => {
    const result = await resolveUiTabOpenCommand(
      { workspaceId: "workspace-1", target: { kind: "agent", agentId: "agent-1" } },
      deps(),
    );

    expect(result).toEqual({
      ok: true,
      serverId: "daemon-server",
      workspaceId: "workspace-1",
      command: {
        type: "ui.command",
        payload: {
          command: "tab.open",
          serverId: "daemon-server",
          workspaceId: "workspace-1",
          target: { kind: "agent", agentId: "agent-1" },
        },
      },
    });
  });

  test("prefers the caller's serverId over the daemon's own", async () => {
    const result = await resolveUiTabOpenCommand(
      {
        serverId: "  caller-server  ",
        workspaceId: "workspace-1",
        target: { kind: "draft" },
      },
      deps(),
    );

    expect(result).toMatchObject({ ok: true, serverId: "caller-server" });
  });

  test("carries focus:false through to the push and omits it otherwise", async () => {
    const unfocused = await resolveUiTabOpenCommand(
      { workspaceId: "workspace-1", target: { kind: "draft" }, focus: false },
      deps(),
    );
    expect(unfocused).toMatchObject({
      ok: true,
      command: { payload: { focus: false } },
    });

    const focused = await resolveUiTabOpenCommand(
      { workspaceId: "workspace-1", target: { kind: "draft" }, focus: true },
      deps(),
    );
    expect(focused.ok && focused.command.payload).toEqual({
      command: "tab.open",
      serverId: "daemon-server",
      workspaceId: "workspace-1",
      target: { kind: "draft" },
    });
  });

  test("rejects an unknown workspace", async () => {
    const result = await resolveUiTabOpenCommand(
      { workspaceId: "workspace-missing", target: { kind: "agent", agentId: "agent-1" } },
      deps(),
    );

    expect(result).toEqual({
      ok: false,
      serverId: "daemon-server",
      workspaceId: "workspace-missing",
      error: "Workspace not found: workspace-missing",
    });
  });

  test("rejects a blank workspaceId without consulting the registry", async () => {
    let lookups = 0;
    const result = await resolveUiTabOpenCommand(
      { workspaceId: "   ", target: { kind: "agent", agentId: "agent-1" } },
      {
        serverId: "daemon-server",
        workspaceExists: async () => {
          lookups += 1;
          return true;
        },
      },
    );

    expect(result).toEqual({
      ok: false,
      serverId: "daemon-server",
      workspaceId: "",
      error: "workspaceId is required",
    });
    expect(lookups).toBe(0);
  });

  test("rejects a target whose identifier is blank", async () => {
    const result = await resolveUiTabOpenCommand(
      { workspaceId: "workspace-1", target: { kind: "terminal", terminalId: "  " } },
      deps(),
    );

    expect(result).toEqual({
      ok: false,
      serverId: "daemon-server",
      workspaceId: "workspace-1",
      error: 'Invalid tab target for kind "terminal"',
    });
  });

  test("trims identifiers before broadcasting", async () => {
    const result = await resolveUiTabOpenCommand(
      { workspaceId: "  workspace-1  ", target: { kind: "file", path: "  src/app.ts  " } },
      deps(),
    );

    expect(result).toMatchObject({
      ok: true,
      workspaceId: "workspace-1",
      command: { payload: { workspaceId: "workspace-1", target: { path: "src/app.ts" } } },
    });
  });
});

describe("normalizeUiWorkspaceTabTarget", () => {
  test("keeps an optional draft id absent when it is blank", () => {
    expect(normalizeUiWorkspaceTabTarget({ kind: "draft", draftId: "  " })).toEqual({
      kind: "draft",
    });
    expect(normalizeUiWorkspaceTabTarget({ kind: "draft", draftId: " draft-1 " })).toEqual({
      kind: "draft",
      draftId: "draft-1",
    });
  });

  test("drops a file line range that ends before it starts", () => {
    expect(
      normalizeUiWorkspaceTabTarget({
        kind: "file",
        path: "src/app.ts",
        lineStart: 20,
        lineEnd: 12,
      }),
    ).toEqual({ kind: "file", path: "src/app.ts", lineStart: 20 });
  });

  test("rejects every target kind whose required identifier is blank", () => {
    expect(normalizeUiWorkspaceTabTarget({ kind: "agent", agentId: " " })).toBeNull();
    expect(
      normalizeUiWorkspaceTabTarget({
        kind: "provider_subagent",
        parentAgentId: "agent-1",
        subagentId: " ",
      }),
    ).toBeNull();
    expect(normalizeUiWorkspaceTabTarget({ kind: "browser", browserId: " " })).toBeNull();
    expect(normalizeUiWorkspaceTabTarget({ kind: "file", path: " " })).toBeNull();
    expect(normalizeUiWorkspaceTabTarget({ kind: "setup", workspaceId: " " })).toBeNull();
    expect(normalizeUiWorkspaceTabTarget({ kind: "commit_diff", sha: " " })).toBeNull();
  });
});
