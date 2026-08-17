import { describe, expect, test } from "vitest";
import {
  ServerInfoStatusPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages.js";

describe("ui command protocol", () => {
  test("accepts a tab open request for each tab kind", () => {
    const targets = [
      { kind: "draft" },
      { kind: "draft", draftId: "draft-1" },
      { kind: "agent", agentId: "agent-1" },
      { kind: "provider_subagent", parentAgentId: "agent-1", subagentId: "child-1" },
      { kind: "terminal", terminalId: "terminal-1" },
      { kind: "browser", browserId: "browser-1" },
      { kind: "file", path: "src/app.ts" },
      { kind: "file", path: "src/app.ts", lineStart: 12, lineEnd: 20 },
      { kind: "working_diff" },
      { kind: "working_diff", focusPath: "src/app.ts" },
      { kind: "setup", workspaceId: "workspace-1" },
      { kind: "commit_diff", sha: "abc1234" },
    ];

    for (const target of targets) {
      expect(
        SessionInboundMessageSchema.parse({
          type: "ui.tab.open.request",
          requestId: "request-1",
          workspaceId: "workspace-1",
          target,
        }),
      ).toMatchObject({ type: "ui.tab.open.request", workspaceId: "workspace-1", target });
    }
  });

  test("keeps serverId and focus optional on the request", () => {
    const minimal = SessionInboundMessageSchema.parse({
      type: "ui.tab.open.request",
      requestId: "request-1",
      workspaceId: "workspace-1",
      target: { kind: "agent", agentId: "agent-1" },
    });
    expect(minimal).toEqual({
      type: "ui.tab.open.request",
      requestId: "request-1",
      workspaceId: "workspace-1",
      target: { kind: "agent", agentId: "agent-1" },
    });

    expect(
      SessionInboundMessageSchema.parse({
        type: "ui.tab.open.request",
        requestId: "request-1",
        serverId: "server-1",
        workspaceId: "workspace-1",
        target: { kind: "agent", agentId: "agent-1" },
        focus: false,
      }),
    ).toMatchObject({ serverId: "server-1", focus: false });
  });

  test("rejects a request with an unknown tab kind", () => {
    expect(
      SessionInboundMessageSchema.safeParse({
        type: "ui.tab.open.request",
        requestId: "request-1",
        workspaceId: "workspace-1",
        target: { kind: "spreadsheet", sheetId: "sheet-1" },
      }).success,
    ).toBe(false);
  });

  test("rejects a request without a workspaceId", () => {
    expect(
      SessionInboundMessageSchema.safeParse({
        type: "ui.tab.open.request",
        requestId: "request-1",
        target: { kind: "agent", agentId: "agent-1" },
      }).success,
    ).toBe(false);
  });

  test("accepts the tab open response and reports delivery count", () => {
    expect(
      SessionOutboundMessageSchema.parse({
        type: "ui.tab.open.response",
        payload: {
          requestId: "request-1",
          serverId: "server-1",
          workspaceId: "workspace-1",
          deliveredTo: 2,
          error: null,
        },
      }),
    ).toMatchObject({ payload: { deliveredTo: 2, error: null } });

    expect(
      SessionOutboundMessageSchema.parse({
        type: "ui.tab.open.response",
        payload: {
          requestId: "request-1",
          serverId: "server-1",
          workspaceId: "workspace-1",
          deliveredTo: 0,
          error: "Workspace not found: workspace-1",
        },
      }),
    ).toMatchObject({ payload: { error: "Workspace not found: workspace-1" } });
  });

  test("accepts the ui.command push", () => {
    expect(
      SessionOutboundMessageSchema.parse({
        type: "ui.command",
        payload: {
          command: "tab.open",
          serverId: "server-1",
          workspaceId: "workspace-1",
          target: { kind: "terminal", terminalId: "terminal-1" },
        },
      }),
    ).toEqual({
      type: "ui.command",
      payload: {
        command: "tab.open",
        serverId: "server-1",
        workspaceId: "workspace-1",
        target: { kind: "terminal", terminalId: "terminal-1" },
      },
    });
  });

  test("rejects a ui.command with an unknown command", () => {
    expect(
      SessionOutboundMessageSchema.safeParse({
        type: "ui.command",
        payload: {
          command: "tab.close",
          workspaceId: "workspace-1",
          target: { kind: "terminal", terminalId: "terminal-1" },
        },
      }).success,
    ).toBe(false);
  });

  test("uiCommands is an optional server_info feature flag", () => {
    const withoutFlag = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "server-1",
      features: {},
    });
    expect(withoutFlag.features?.uiCommands).toBeUndefined();

    const withFlag = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "server-1",
      features: { uiCommands: true },
    });
    expect(withFlag.features?.uiCommands).toBe(true);
  });
});
