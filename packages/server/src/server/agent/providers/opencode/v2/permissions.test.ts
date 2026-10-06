import { describe, expect, test } from "vitest";

import { createTestLogger } from "../../../../../test-utils/test-logger.js";
import type { V2Api } from "./api.js";
import { OpenCodeV2AgentClient } from "./agent.js";
import { SessionPermissions } from "./permissions.js";
import { CompanionStreamCollector } from "../../../companion-stream.js";
import type { CompanionEntry } from "@getpaseo/protocol/companion-stream";
import type { AgentStreamEvent } from "../../../agent-sdk-types.js";
import { V2Harness } from "../test-utils/v2-harness.js";

describe("OpenCode v2 questions", () => {
  test.each(["expiry", "user denial", "provider cancellation"])(
    "preserves needed input unless explicitly denied: %s",
    async (cause) => {
      const harness = new V2Harness();
      const collector = new CompanionStreamCollector();
      const events: AgentStreamEvent[] = [];
      let entries: CompanionEntry[] = [];
      const permissions = new SessionPermissions(
        () => harness.api,
        "session",
        { provider: "opencode", cwd: "/tmp/project" },
        (event) => {
          events.push(event);
          entries = collector.observe("agent", entries, event, "2026-10-05T12:00:00Z");
        },
      );
      harness.api.session.form.list = async () => [
        {
          id: "question",
          sessionID: "session",
          title: "Input",
          fields: [{ key: "region", title: "Which region?", type: "string" }],
        },
      ];
      harness.api.session.form.cancel = async () => {
        permissions.observe({
          id: "cancel",
          created: 2,
          type: "form.cancelled",
          data: { id: "question", sessionID: "session" },
        });
      };
      await permissions.reconcile("session");
      if (cause === "expiry") await permissions.expireAll();
      else if (cause === "user denial")
        await permissions.respondToPermission("question", { behavior: "deny" });
      else
        permissions.observe({
          id: "provider-cancel",
          created: 2,
          type: "form.cancelled",
          data: { id: "question", sessionID: "session" },
        });
      const expired = cause !== "user denial";
      expect(events.filter((event) => event.type === "permission_resolved")).toEqual([
        {
          type: "permission_resolved",
          provider: "opencode",
          requestId: "question",
          resolution: { behavior: "deny" },
          ...(expired ? { disposition: "expired" } : {}),
        },
      ]);
      permissions.observe({
        id: "duplicate-cancel",
        created: 3,
        type: "form.cancelled",
        data: { id: "question", sessionID: "session" },
      });
      entries = collector.observe(
        "agent",
        entries,
        {
          type: "turn_canceled",
          provider: "opencode",
          reason: "Interrupted",
          turnId: "turn",
        },
        "2026-10-05T12:00:00Z",
      );
      expect(events.filter((event) => event.type === "permission_resolved")).toHaveLength(1);
      expect(entries).toEqual([
        expect.objectContaining({
          text: "Which region?",
          kind: expired ? "question" : "permission",
          status: expired ? "open" : "denied",
        }),
        {
          id: "turn:turn",
          kind: "outcome",
          status: "canceled",
          text: "Interrupted",
          timestamp: "2026-10-05T12:00:00Z",
          truncated: false,
        },
      ]);
      expect(permissions.list()).toEqual([]);
    },
  );

  test("preserves provider-canceled input after a failed explicit denial", async () => {
    const harness = new V2Harness();
    const events: AgentStreamEvent[] = [];
    const permissions = new SessionPermissions(
      () => harness.api,
      "session",
      { provider: "opencode", cwd: "/tmp/project" },
      (event) => events.push(event),
    );
    harness.api.session.form.list = async () => [
      {
        id: "question",
        sessionID: "session",
        title: "Input",
        fields: [{ key: "region", title: "Which region?", type: "string" }],
      },
    ];
    harness.api.session.form.cancel = async () => {
      throw new Error("Cancellation failed");
    };
    await permissions.reconcile("session");
    await expect(permissions.respondToPermission("question", { behavior: "deny" })).rejects.toThrow(
      "Cancellation failed",
    );
    expect(permissions.list()).toHaveLength(1);
    permissions.observe({
      id: "provider-cancel",
      created: 2,
      type: "form.cancelled",
      data: { id: "question", sessionID: "session" },
    });
    expect(events.at(-1)).toEqual({
      type: "permission_resolved",
      provider: "opencode",
      requestId: "question",
      resolution: { behavior: "deny" },
      disposition: "expired",
    });
  });

  test("maps selected labels to native values and parses numeric and boolean answers", async () => {
    const harness = new V2Harness();
    harness.api.session.form.list = async () => [
      {
        id: "question",
        sessionID: "session",
        title: "Preferences",
        fields: [
          { key: "color", type: "string", options: [{ label: "Blue", value: "blue-id" }] },
          {
            key: "features",
            type: "multiselect",
            options: [{ label: "Search", value: "search-id" }],
          },
          { key: "count", type: "integer" },
          { key: "enabled", type: "boolean" },
        ],
      },
    ];
    const answers: Parameters<V2Api["session"]["form"]["reply"]>[0][] = [];
    harness.api.session.form.reply = async (input) => {
      answers.push(input);
    };
    const client = new OpenCodeV2AgentClient({
      logger: createTestLogger(),
      runtime: harness.runtime,
    });
    const session = await client.createSession({ provider: "opencode", cwd: "/tmp/project" });
    try {
      expect(session.getPendingPermissions()).toHaveLength(1);
      await session.respondToPermission("question", {
        behavior: "allow",
        updatedInput: {
          answers: {
            color: "Blue",
            features: ["Search"],
            count: "3",
            enabled: "false",
          },
        },
      });
      expect(answers).toEqual([
        {
          sessionID: "session",
          formID: "question",
          answer: {
            color: "blue-id",
            features: ["search-id"],
            count: 3,
            enabled: false,
          },
        },
      ]);
      expect(session.getPendingPermissions()).toHaveLength(0);
    } finally {
      await session.close();
    }
  });
});

describe("OpenCode v2 permission routing", () => {
  test("expires tool approvals without converting them to manual questions", async () => {
    const harness = new V2Harness();
    const collector = new CompanionStreamCollector();
    let entries: CompanionEntry[] = [];
    const permissions = new SessionPermissions(
      () => harness.api,
      "session",
      { provider: "opencode", cwd: "/tmp/project" },
      (event) => {
        entries = collector.observe("agent", entries, event, "2026-10-05T12:00:00Z");
      },
    );
    harness.api.permission.list = async () => [
      { id: "approval", sessionID: "session", action: "shell", resources: ["pwd"] },
    ];
    harness.api.permission.reply = async () => {
      permissions.observe({
        id: "rejected",
        created: 2,
        type: "permission.replied",
        data: { sessionID: "session", requestID: "approval", reply: "reject" },
      });
    };
    await permissions.reconcile("session");
    await permissions.expireAll();
    expect(entries).toEqual([
      expect.objectContaining({
        kind: "permission",
        requestKind: "tool",
        status: "expired",
        text: "pwd",
      }),
    ]);
    expect(permissions.list()).toEqual([]);
  });

  test("routes a child approval back to its owning session", async () => {
    const harness = new V2Harness();
    const child = { ...harness.info, id: "child", parentID: "session" };
    harness.api.session.list = async (input) => ({
      data: input?.parentID === "session" ? [child] : [],
      cursor: {},
    });
    harness.api.permission.list = async (input) =>
      input.sessionID === "child"
        ? [{ id: "child-permission", sessionID: "child", action: "shell", resources: ["pwd"] }]
        : [];
    const replies: Parameters<V2Api["permission"]["reply"]>[0][] = [];
    harness.api.permission.reply = async (input) => {
      replies.push(input);
    };
    const client = new OpenCodeV2AgentClient({
      logger: createTestLogger(),
      runtime: harness.runtime,
    });
    const session = await client.createSession({ provider: "opencode", cwd: "/tmp/project" });
    try {
      expect(session.getPendingPermissions()).toHaveLength(1);
      await session.respondToPermission("child-permission", {
        behavior: "allow",
        selectedActionId: "once",
      });
      expect(replies).toEqual([
        { sessionID: "child", requestID: "child-permission", decision: "once" },
      ]);
    } finally {
      await session.close();
    }
  });

  test("clears an approval resolved by another native client", async () => {
    const harness = new V2Harness();
    harness.api.permission.list = async () => [
      { id: "approval", sessionID: "session", action: "shell", resources: ["pwd"] },
    ];
    const client = new OpenCodeV2AgentClient({
      logger: createTestLogger(),
      runtime: harness.runtime,
    });
    const session = await client.createSession({ provider: "opencode", cwd: "/tmp/project" });
    try {
      expect(session.getPendingPermissions()).toHaveLength(1);
      harness.api.permission.list = async () => [];
      harness.push({
        id: "resolved",
        created: 2,
        type: "permission.replied",
        data: { sessionID: "session", requestID: "approval", reply: "once" },
      });
      await expect.poll(() => session.getPendingPermissions()).toEqual([]);
    } finally {
      await session.close();
    }
  });
});
