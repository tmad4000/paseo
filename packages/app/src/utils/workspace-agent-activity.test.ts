import { describe, expect, it } from "vitest";
import type { Agent } from "@/stores/session-store";
import { buildWorkspaceAgentActivityIndex } from "./workspace-agent-activity";

function agent(input: {
  id: string;
  workspaceId?: string;
  status?: Agent["status"];
  turn?: Agent["turn"];
  updatedAt: string;
  lastActivityAt?: string;
  attentionTimestamp?: string | null;
  requiresAttention?: boolean;
  attentionReason?: Agent["attentionReason"];
  pendingPermissionCount?: number;
  archivedAt?: string | null;
  parentAgentId?: string | null;
}): Agent {
  return {
    serverId: "host-a",
    id: input.id,
    provider: "codex",
    status: input.status ?? "idle",
    turn:
      input.turn ??
      (input.status === "running"
        ? {
            phase: "open",
            turnId: "turn-1",
            startedAt: null,
            cancellationRequestId: null,
          }
        : { phase: "idle", cancellationRequestId: null }),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date(input.updatedAt),
    lastUserMessageAt: null,
    lastActivityAt: new Date(input.lastActivityAt ?? input.updatedAt),
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    },
    currentModeId: null,
    availableModes: [],
    pendingPermissions: Array.from({ length: input.pendingPermissionCount ?? 0 }, (_, index) => ({
      id: `permission-${index}`,
      provider: "codex",
      name: "shell",
      kind: "tool",
      input: {},
    })),
    persistence: null,
    title: null,
    cwd: "/repo",
    workspaceId: input.workspaceId,
    model: null,
    requiresAttention: input.requiresAttention,
    attentionReason: input.attentionReason,
    attentionTimestamp: input.attentionTimestamp ? new Date(input.attentionTimestamp) : null,
    archivedAt: input.archivedAt ? new Date(input.archivedAt) : null,
    parentAgentId: input.parentAgentId ?? null,
    labels: {},
  };
}

describe("workspace agent activity index", () => {
  it("uses turn liveness for running while preserving protocol lifecycle states", () => {
    const result = buildWorkspaceAgentActivityIndex(
      new Map([
        [
          "open",
          agent({
            id: "open",
            workspaceId: "workspace-open",
            status: "idle",
            turn: {
              phase: "open",
              turnId: null,
              startedAt: null,
              cancellationRequestId: null,
            },
            updatedAt: "2026-01-01T00:00:00.000Z",
          }),
        ],
        [
          "idle-error",
          agent({
            id: "idle-error",
            workspaceId: "workspace-error",
            status: "error",
            turn: { phase: "idle", cancellationRequestId: null },
            updatedAt: "2026-01-01T00:00:00.000Z",
          }),
        ],
      ]),
    );

    expect(result.get("workspace-open")?.status).toBe("running");
    expect(result.get("workspace-error")?.status).toBe("failed");
  });

  it("keeps the latest active root agent for each workspace", () => {
    const index = buildWorkspaceAgentActivityIndex(
      new Map([
        [
          "older",
          agent({
            id: "older",
            workspaceId: "workspace-a",
            status: "running",
            updatedAt: "2026-06-01T10:00:00.000Z",
          }),
        ],
        [
          "permission",
          agent({
            id: "permission",
            workspaceId: "workspace-a",
            updatedAt: "2026-06-01T10:01:00.000Z",
            pendingPermissionCount: 1,
          }),
        ],
        [
          "attention",
          agent({
            id: "attention",
            workspaceId: "workspace-b",
            updatedAt: "2026-06-01T10:00:00.000Z",
            attentionTimestamp: "2026-06-01T10:02:00.000Z",
            requiresAttention: true,
            attentionReason: "finished",
          }),
        ],
      ]),
    );

    expect(index).toEqual(
      new Map([
        [
          "workspace-a",
          {
            agentId: "permission",
            status: "needs_input",
            enteredAt: new Date("2026-06-01T10:01:00.000Z"),
            lastActivityAt: new Date("2026-06-01T10:01:00.000Z"),
            lastMessageAt: new Date("2026-01-01T00:00:00.000Z"),
            lastUserMessageAt: new Date("2026-01-01T00:00:00.000Z"),
            lastAssistantMessageAt: new Date("2026-01-01T00:00:00.000Z"),
          },
        ],
        [
          "workspace-b",
          {
            agentId: "attention",
            status: "attention",
            enteredAt: new Date("2026-06-01T10:02:00.000Z"),
            lastActivityAt: new Date("2026-06-01T10:00:00.000Z"),
            lastMessageAt: new Date("2026-01-01T00:00:00.000Z"),
            lastUserMessageAt: new Date("2026-01-01T00:00:00.000Z"),
            lastAssistantMessageAt: new Date("2026-01-01T00:00:00.000Z"),
          },
        ],
      ]),
    );
  });

  it("does not let archived or child agents change root workspace activity", () => {
    const index = buildWorkspaceAgentActivityIndex(
      new Map([
        [
          "root",
          agent({
            id: "root",
            workspaceId: "workspace-a",
            status: "running",
            updatedAt: "2026-06-01T10:00:00.000Z",
          }),
        ],
        [
          "child",
          agent({
            id: "child",
            workspaceId: "workspace-a",
            updatedAt: "2026-06-01T10:03:00.000Z",
            pendingPermissionCount: 1,
            parentAgentId: "root",
          }),
        ],
        [
          "archived",
          agent({
            id: "archived",
            workspaceId: "workspace-a",
            updatedAt: "2026-06-01T10:04:00.000Z",
            requiresAttention: true,
            attentionReason: "error",
            archivedAt: "2026-06-01T10:04:00.000Z",
          }),
        ],
      ]),
    );

    expect(index.get("workspace-a")).toEqual({
      agentId: "root",
      status: "running",
      enteredAt: new Date("2026-06-01T10:00:00.000Z"),
      lastActivityAt: new Date("2026-06-01T10:00:00.000Z"),
      lastMessageAt: new Date("2026-01-01T00:00:00.000Z"),
      lastUserMessageAt: new Date("2026-01-01T00:00:00.000Z"),
      lastAssistantMessageAt: new Date("2026-01-01T00:00:00.000Z"),
    });
  });

  it("treats a cross-workspace subagent as activity in its own workspace", () => {
    const index = buildWorkspaceAgentActivityIndex(
      new Map([
        [
          "parent",
          agent({
            id: "parent",
            workspaceId: "workspace-a",
            updatedAt: "2026-06-01T10:00:00.000Z",
          }),
        ],
        [
          "child",
          agent({
            id: "child",
            workspaceId: "workspace-b",
            status: "running",
            updatedAt: "2026-06-01T10:03:00.000Z",
            parentAgentId: "parent",
          }),
        ],
      ]),
    );

    expect(index).toEqual(
      new Map([
        [
          "workspace-a",
          {
            agentId: "parent",
            status: "done",
            enteredAt: new Date("2026-06-01T10:00:00.000Z"),
            lastActivityAt: new Date("2026-06-01T10:00:00.000Z"),
            lastMessageAt: new Date("2026-01-01T00:00:00.000Z"),
            lastUserMessageAt: new Date("2026-01-01T00:00:00.000Z"),
            lastAssistantMessageAt: new Date("2026-01-01T00:00:00.000Z"),
          },
        ],
        [
          "workspace-b",
          {
            agentId: "child",
            status: "running",
            enteredAt: new Date("2026-06-01T10:03:00.000Z"),
            lastActivityAt: new Date("2026-06-01T10:03:00.000Z"),
            lastMessageAt: new Date("2026-01-01T00:00:00.000Z"),
            lastUserMessageAt: new Date("2026-01-01T00:00:00.000Z"),
            lastAssistantMessageAt: new Date("2026-01-01T00:00:00.000Z"),
          },
        ],
      ]),
    );
  });

  it("preserves the activity index while the same agent remains in the same status", () => {
    const previous = buildWorkspaceAgentActivityIndex(
      new Map([
        [
          "root",
          agent({
            id: "root",
            workspaceId: "workspace-a",
            status: "running",
            updatedAt: "2026-06-01T10:00:00.000Z",
          }),
        ],
      ]),
    );

    const next = buildWorkspaceAgentActivityIndex(
      new Map([
        [
          "root",
          agent({
            id: "root",
            workspaceId: "workspace-a",
            status: "running",
            updatedAt: "2026-06-01T10:05:00.000Z",
            lastActivityAt: "2026-06-01T10:00:00.000Z",
          }),
        ],
      ]),
      previous,
    );

    expect(next).toBe(previous);
    expect(next.get("workspace-a")?.enteredAt).toEqual(new Date("2026-06-01T10:00:00.000Z"));
  });

  it("records a new entry time when an agent changes status", () => {
    const previous = buildWorkspaceAgentActivityIndex(
      new Map([
        [
          "root",
          agent({
            id: "root",
            workspaceId: "workspace-a",
            status: "running",
            updatedAt: "2026-06-01T10:00:00.000Z",
          }),
        ],
      ]),
    );

    const next = buildWorkspaceAgentActivityIndex(
      new Map([
        [
          "root",
          agent({
            id: "root",
            workspaceId: "workspace-a",
            status: "idle",
            updatedAt: "2026-06-01T10:05:00.000Z",
            pendingPermissionCount: 1,
          }),
        ],
      ]),
      previous,
    );

    expect(next).not.toBe(previous);
    expect(next.get("workspace-a")).toEqual({
      agentId: "root",
      status: "needs_input",
      enteredAt: new Date("2026-06-01T10:05:00.000Z"),
      lastActivityAt: new Date("2026-06-01T10:05:00.000Z"),
      lastMessageAt: new Date("2026-01-01T00:00:00.000Z"),
      lastUserMessageAt: new Date("2026-01-01T00:00:00.000Z"),
      lastAssistantMessageAt: new Date("2026-01-01T00:00:00.000Z"),
    });
  });

  it("updates recency when activity changes without changing the status entry time", () => {
    const previous = buildWorkspaceAgentActivityIndex(
      new Map([
        [
          "root",
          agent({
            id: "root",
            workspaceId: "workspace-a",
            status: "running",
            updatedAt: "2026-06-01T10:00:00.000Z",
          }),
        ],
      ]),
    );
    const next = buildWorkspaceAgentActivityIndex(
      new Map([
        [
          "root",
          agent({
            id: "root",
            workspaceId: "workspace-a",
            status: "running",
            updatedAt: "2026-06-01T10:05:00.000Z",
          }),
        ],
      ]),
      previous,
    );
    expect(next).not.toBe(previous);
    expect(next.get("workspace-a")?.enteredAt).toEqual(new Date("2026-06-01T10:00:00.000Z"));
    expect(next.get("workspace-a")?.lastActivityAt).toEqual(new Date("2026-06-01T10:05:00.000Z"));
  });
});

it("aggregates actual root conversation clocks and falls back only when the role clock is unknown", () => {
  const root = agent({ id: "root", workspaceId: "workspace", updatedAt: "2026-10-01T00:00:00Z" });
  root.messageActivity = {
    lastUserMessageAt: "2025-12-01T00:00:00.000Z",
    lastAssistantMessageAt: null,
  };
  const initial = buildWorkspaceAgentActivityIndex(new Map([[root.id, root]]));
  expect(initial.get("workspace")?.lastMessageAt?.toISOString()).toBe("2025-12-01T00:00:00.000Z");
  const second = {
    ...root,
    id: "second",
    messageActivity: {
      lastUserMessageAt: "2026-01-03T00:00:00.000Z",
      lastAssistantMessageAt: "2026-01-04T00:00:00.000Z",
    },
  };
  const child = {
    ...second,
    id: "child",
    parentAgentId: "root",
    messageActivity: {
      lastUserMessageAt: "2026-02-01T00:00:00.000Z",
      lastAssistantMessageAt: null,
    },
  };
  const archived = { ...child, id: "archived", parentAgentId: null, archivedAt: new Date() };
  const indexed = buildWorkspaceAgentActivityIndex(
    new Map([root, second, child, archived].map((a) => [a.id, a])),
  );
  expect(indexed.get("workspace")?.lastMessageAt?.toISOString()).toBe("2026-01-04T00:00:00.000Z");
  expect(indexed.get("workspace")?.lastUserMessageAt?.toISOString()).toBe(
    "2026-01-03T00:00:00.000Z",
  );
  root.messageActivity = { lastUserMessageAt: null, lastAssistantMessageAt: null };
  const unknown = buildWorkspaceAgentActivityIndex(new Map([[root.id, root]]));
  expect(unknown.get("workspace")?.lastMessageAt).toEqual(root.createdAt);
  expect(unknown.get("workspace")?.lastUserMessageAt).toEqual(root.createdAt);
});

it("updates assistant-only workspace activity without changing the latest conversation or user clocks", () => {
  const original = agent({
    id: "root",
    workspaceId: "workspace",
    updatedAt: "2026-01-05T00:00:00.000Z",
  });
  original.messageActivity = {
    lastUserMessageAt: "2026-01-05T00:00:00.000Z",
    lastAssistantMessageAt: "2026-01-02T00:00:00.000Z",
  };
  const before = buildWorkspaceAgentActivityIndex(new Map([[original.id, original]]));
  const updated = {
    ...original,
    messageActivity: {
      ...original.messageActivity,
      lastAssistantMessageAt: "2026-01-03T00:00:00.000Z",
    },
  };
  const after = buildWorkspaceAgentActivityIndex(new Map([[updated.id, updated]]), before);
  expect(after).not.toBe(before);
  expect(after.get("workspace")?.lastAssistantMessageAt?.toISOString()).toBe(
    "2026-01-03T00:00:00.000Z",
  );
  expect(after.get("workspace")?.lastMessageAt).toEqual(before.get("workspace")?.lastMessageAt);
  expect(after.get("workspace")?.lastUserMessageAt).toEqual(
    before.get("workspace")?.lastUserMessageAt,
  );
  const unknown = {
    ...original,
    messageActivity: { lastUserMessageAt: null, lastAssistantMessageAt: null },
  };
  expect(
    buildWorkspaceAgentActivityIndex(new Map([[unknown.id, unknown]])).get("workspace")
      ?.lastAssistantMessageAt,
  ).toEqual(unknown.createdAt);
});

it("uses the legacy last-user clock for agents from hosts without message activity", () => {
  const legacy = agent({
    id: "legacy",
    workspaceId: "workspace",
    updatedAt: "2026-10-01T00:00:00Z",
  });
  legacy.lastUserMessageAt = new Date("2026-09-15T00:00:00.000Z");
  const indexed = buildWorkspaceAgentActivityIndex(new Map([[legacy.id, legacy]]));
  expect(indexed.get("workspace")?.lastUserMessageAt?.toISOString()).toBe(
    "2026-09-15T00:00:00.000Z",
  );
  expect(indexed.get("workspace")?.lastMessageAt?.toISOString()).toBe("2026-09-15T00:00:00.000Z");
  expect(indexed.get("workspace")?.lastAssistantMessageAt).toEqual(legacy.createdAt);

  // A supporting host's explicit "no user message yet" is not overridden by the legacy field.
  legacy.messageActivity = { lastUserMessageAt: null, lastAssistantMessageAt: null };
  const supported = buildWorkspaceAgentActivityIndex(new Map([[legacy.id, legacy]]));
  expect(supported.get("workspace")?.lastUserMessageAt).toEqual(legacy.createdAt);
});
