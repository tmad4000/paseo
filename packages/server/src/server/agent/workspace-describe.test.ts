import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { StreamListOptions, StreamRow } from "@getpaseo/protocol/global-stream";
import { PARENT_AGENT_ID_LABEL } from "@getpaseo/protocol/agent-labels";
import { createTestLogger } from "../../test-utils/test-logger.js";
import type { AgentManager, ManagedAgent } from "./agent-manager.js";
import type { AgentStorage, StoredAgentRecord } from "./agent-storage.js";
import type { AgentTimelineItem, AgentProvider } from "./agent-sdk-types.js";
import { toAgentListItemPayload, buildStoredAgentPayload } from "./agent-projections.js";
import {
  describeWorkspace,
  toOpenAsks,
  toPins,
  type ConversationReader,
  type DescribeWorkspaceDeps,
} from "./workspace-describe.js";
import type { PersistedWorkspaceRecord } from "../workspace-registry.js";
import { PersistedConversationReader } from "../session-text-history.js";
import { claudeProjectDirSync } from "./providers/claude/project-dir.js";

const WORKSPACE_ID = "wks_tabs";
const OTHER_WORKSPACE_ID = "wks_other";

function storedRecord(
  overrides: Partial<StoredAgentRecord> & Pick<StoredAgentRecord, "id">,
): StoredAgentRecord {
  return {
    provider: "claude",
    cwd: "/tmp/repo",
    workspaceId: WORKSPACE_ID,
    createdAt: "2026-10-27T10:00:00.000Z",
    updatedAt: "2026-10-27T11:00:00.000Z",
    labels: {},
    lastStatus: "idle",
    title: null,
    persistence: { provider: "claude", sessionId: `session-${overrides.id}` },
    ...overrides,
  } as StoredAgentRecord;
}

function askRow(agentId: string, id: string, text: string, state: string): StreamRow {
  return {
    id: `${agentId}:${id}`,
    agentId,
    agentTitle: "",
    cwd: "/tmp/repo",
    archived: false,
    timestamp: "2026-10-27T10:30:00.000Z",
    item: {
      kind: "entry",
      entry: {
        id: `ask:${id}`,
        kind: "question",
        status: "open",
        timestamp: "2026-10-27T10:30:00.000Z",
        text,
        truncated: false,
        ask: {
          state,
          remaining: "",
          evidence: "",
          revision: 1,
          provenance: "explicit",
        },
      },
    },
  } as StreamRow;
}

function pinRow(agentId: string, id: string, text: string): StreamRow {
  return {
    id: `${agentId}:${id}`,
    agentId,
    agentTitle: "",
    cwd: "/tmp/repo",
    archived: false,
    timestamp: "2026-10-27T10:31:00.000Z",
    item: {
      kind: "entry",
      entry: { id, kind: "pin", timestamp: "2026-10-27T10:31:00.000Z", text, truncated: false },
    },
  } as StreamRow;
}

interface FakeOptions {
  records: StoredAgentRecord[];
  transcripts?: Record<string, Array<{ role: "user" | "assistant"; text: string }>>;
  firstUser?: Record<string, string>;
  live?: Record<string, AgentTimelineItem[]>;
  stream?: Record<string, StreamRow[]>;
  streamFails?: boolean;
  workspace?: Partial<PersistedWorkspaceRecord> | null;
}

function createDeps(
  options: FakeOptions,
): DescribeWorkspaceDeps & { streamCalls: StreamListOptions[] } {
  const streamCalls: StreamListOptions[] = [];
  const conversationReader: ConversationReader = {
    read: async (source) => options.transcripts?.[source.agentId] ?? [],
    readFirstUserMessage: async (source) => options.firstUser?.[source.agentId] ?? null,
  };
  const agentManager = {
    listAgents: () => [] as ManagedAgent[],
    getAgent: (id: string) => (options.live?.[id] ? ({ id } as ManagedAgent) : null),
    getTimeline: (id: string) => options.live?.[id] ?? [],
    readRecentConversationMessages: async (id: string) =>
      (options.live?.[id] ?? []).flatMap((item) =>
        item.type === "user_message" || item.type === "assistant_message"
          ? [
              {
                text: item.text,
                role: item.type === "user_message" ? ("user" as const) : ("assistant" as const),
                timestamp: "",
                seq: 0,
              },
            ]
          : [],
      ),
    listGlobalStream: async (list: StreamListOptions) => {
      streamCalls.push(list);
      if (options.streamFails) throw new Error("Stream unavailable");
      const rows = (options.stream?.[list.agentId ?? ""] ?? []).filter((row) =>
        list.view === "saved"
          ? row.item.kind === "entry" && row.item.entry.kind === "pin"
          : row.item.kind === "entry" && Boolean(row.item.entry.ask),
      );
      return { rows, nextCursor: null, tagCounts: [], pinnedTags: [] };
    },
  } as unknown as DescribeWorkspaceDeps["agentManager"];
  const workspace =
    options.workspace === null
      ? null
      : ({
          workspaceId: WORKSPACE_ID,
          projectId: "prj",
          cwd: "/tmp/repo",
          kind: "directory",
          displayName: "repo",
          title: "Workspace tabs",
          ...options.workspace,
        } as PersistedWorkspaceRecord);
  return {
    agentManager,
    agentStorage: { list: async () => options.records } as unknown as AgentStorage,
    listRegisteredProviderIds: () => ["claude", "codex"] as AgentProvider[],
    workspaceRegistry: {
      get: async (id: string) => (id === WORKSPACE_ID ? workspace : null),
    },
    conversationReader,
    logger: createTestLogger(),
    now: () => new Date("2026-10-27T12:00:00.000Z"),
    streamCalls,
  };
}

describe("describeWorkspace", () => {
  it("describes every non-archived agent in the workspace with a derived focus summary", async () => {
    const deps = createDeps({
      records: [
        storedRecord({
          id: "agent-a",
          title: "Build describe tool",
          createdAt: "2026-10-27T09:00:00.000Z",
        }),
        storedRecord({
          id: "agent-b",
          title: "Review",
          labels: { [PARENT_AGENT_ID_LABEL]: "agent-a" },
          config: { model: "opus" } as StoredAgentRecord["config"],
        }),
        storedRecord({ id: "agent-archived", archivedAt: "2026-10-27T11:30:00.000Z" }),
        storedRecord({ id: "agent-elsewhere", workspaceId: OTHER_WORKSPACE_ID }),
        storedRecord({ id: "agent-internal", internal: true }),
      ],
      firstUser: { "agent-a": "Add describe_workspace to the fork" },
      transcripts: {
        "agent-a": [
          { role: "user", text: "Add describe_workspace to the fork" },
          { role: "assistant", text: "Reading paseo-tools.ts first." },
          { role: "user", text: "Also give list_agents a workspaceId" },
          { role: "assistant", text: "Done; tests pass.\n\nNext I will open the PR." },
        ],
      },
      stream: {
        "agent-a": [
          askRow("agent-a", "ship", "Ship describe_workspace", "in_progress"),
          askRow("agent-a", "old", "Earlier ask", "done"),
          pinRow("agent-a", "pin:1", "Do not restart the live daemon"),
        ],
      },
    });

    const description = await describeWorkspace(deps, { workspaceId: WORKSPACE_ID });

    expect(description.workspaceId).toBe(WORKSPACE_ID);
    expect(description.title).toBe("Workspace tabs");
    expect(description.cwd).toBe("/tmp/repo");
    expect(description.generatedAt).toBe("2026-10-27T12:00:00.000Z");
    expect(description.agents.map((agent) => agent.id)).toEqual(["agent-a", "agent-b"]);

    const [first, second] = description.agents;
    expect(first!.focus).toEqual({
      firstUserMessage: "Add describe_workspace to the fork",
      lastUserMessage: "Also give list_agents a workspaceId",
      lastAssistantMessage: "Done; tests pass. Next I will open the PR.",
      summary:
        'Started with "Add describe_workspace to the fork". Latest user message: "Also give list_agents a workspaceId". ' +
        'Last reply began: "Done; tests pass. Next I will open the PR.". Open asks: Ship describe_workspace [in_progress]. ' +
        'Pinned: "Do not restart the live daemon".',
    });
    expect(first!.openAsks).toEqual([
      { askId: "ship", text: "Ship describe_workspace", state: "in_progress" },
    ]);
    expect(first!.pins).toEqual([{ entryId: "pin:1", text: "Do not restart the live daemon" }]);
    expect(first!.parentAgentId).toBeNull();

    expect(second).toMatchObject({
      title: "Review",
      provider: "claude",
      model: "opus",
      parentAgentId: "agent-a",
      openAsks: [],
      pins: [],
    });
    expect(second!.focus.summary).toBe('No readable conversation yet; titled "Review".');
  });

  it("skips Paseo-injected turns when picking the latest user message", async () => {
    const deps = createDeps({
      records: [storedRecord({ id: "orchestrator" })],
      transcripts: {
        orchestrator: [
          { role: "user", text: "Ship the release" },
          { role: "assistant", text: "Delegated to a child." },
          {
            role: "user",
            text: "<paseo-system>\nAgent abc (child) finished.\n</paseo-system>",
          },
        ],
      },
    });
    const [agent] = (await describeWorkspace(deps, { workspaceId: WORKSPACE_ID })).agents;
    expect(agent!.focus.lastUserMessage).toBe("Ship the release");
    expect(agent!.focus.lastAssistantMessage).toBe("Delegated to a child.");
  });

  it("leaves out the excluded caller", async () => {
    const deps = createDeps({
      records: [storedRecord({ id: "caller" }), storedRecord({ id: "other-tab" })],
    });
    const description = await describeWorkspace(deps, {
      workspaceId: WORKSPACE_ID,
      excludeAgentId: "caller",
    });
    expect(description.agents.map((agent) => agent.id)).toEqual(["other-tab"]);
  });

  it("prefers the loaded timeline for loaded agents", async () => {
    const deps = createDeps({
      records: [storedRecord({ id: "loaded" })],
      live: {
        loaded: [
          { type: "user_message", text: "first live prompt" },
          { type: "assistant_message", text: "working" },
          { type: "user_message", text: "second live prompt" },
        ],
      },
      transcripts: { loaded: [{ role: "user", text: "stale transcript" }] },
    });
    const [agent] = (await describeWorkspace(deps, { workspaceId: WORKSPACE_ID })).agents;
    expect(agent!.focus.firstUserMessage).toBe("first live prompt");
    expect(agent!.focus.lastUserMessage).toBe("second live prompt");
    expect(agent!.focus.lastAssistantMessage).toBe("working");
  });

  it("reports Stream items as null when Stream cannot be read", async () => {
    const deps = createDeps({ records: [storedRecord({ id: "agent-a" })], streamFails: true });
    const [agent] = (await describeWorkspace(deps, { workspaceId: WORKSPACE_ID })).agents;
    expect(agent!.openAsks).toBeNull();
    expect(agent!.pins).toBeNull();
  });

  it("reads asks and pins per agent without starting providers", async () => {
    const deps = createDeps({ records: [storedRecord({ id: "agent-a" })] });
    await describeWorkspace(deps, { workspaceId: WORKSPACE_ID });
    expect(deps.streamCalls).toEqual([
      { agentId: "agent-a", includeArchived: true, view: "tasks", filter: "all", limit: 100 },
      { agentId: "agent-a", includeArchived: true, view: "saved", filter: "all", limit: 20 },
    ]);
  });

  it("rejects an unknown workspace with no agents", async () => {
    const deps = createDeps({ records: [], workspace: null });
    await expect(describeWorkspace(deps, { workspaceId: "wks_missing" })).rejects.toThrow(
      "Workspace not found: wks_missing",
    );
  });
});

describe("toOpenAsks / toPins", () => {
  it("skips finished asks, mirrored canonical tasks and non-pin entries", () => {
    const mirrored = askRow("a", "mirror", "Mirrored", "open");
    if (mirrored.item.kind === "entry" && mirrored.item.entry.ask) {
      mirrored.item.entry.ask.canonicalTask = { serverId: "s", agentId: "b", entryId: "ask:x" };
    }
    const rows = [
      askRow("a", "one", "One", "open"),
      askRow("a", "two", "Two", "done"),
      mirrored,
      pinRow("a", "pin:9", "Pinned"),
    ];
    expect(toOpenAsks(rows)).toEqual([{ askId: "one", text: "One", state: "open" }]);
    expect(toPins(rows)).toEqual([{ entryId: "pin:9", text: "Pinned" }]);
  });
});

describe("toAgentListItemPayload", () => {
  it("carries workspaceId and parentAgentId for list_agents", () => {
    const record = storedRecord({
      id: "child",
      labels: { [PARENT_AGENT_ID_LABEL]: "parent" },
    });
    const item = toAgentListItemPayload(buildStoredAgentPayload(record, ["claude"]));
    expect(item.workspaceId).toBe(WORKSPACE_ID);
    expect(item.parentAgentId).toBe("parent");
  });

  it("omits both fields when absent", () => {
    const record = storedRecord({ id: "root", workspaceId: undefined });
    const item = toAgentListItemPayload(buildStoredAgentPayload(record, ["claude"]));
    expect(item).not.toHaveProperty("workspaceId");
    expect(item).not.toHaveProperty("parentAgentId");
  });
});

describe("PersistedConversationReader.readFirstUserMessage", () => {
  let dir: string | null = null;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = null;
  });

  it("reads the first user message from the head of a Claude transcript", async () => {
    dir = await mkdtemp(join(tmpdir(), "paseo-describe-"));
    const projectDir = claudeProjectDirSync("/tmp/repo", { configDir: dir });
    await mkdir(projectDir, { recursive: true });
    const line = (type: string, text: string) =>
      JSON.stringify({ type, message: { content: [{ type: "text", text }] } });
    const filler = Array.from({ length: 4000 }, (_, index) =>
      line("assistant", `filler ${index} ${"x".repeat(400)}`),
    );
    await writeFile(
      join(projectDir, "session-1.jsonl"),
      [line("user", "the very first prompt"), ...filler, line("user", "a late prompt")].join("\n"),
    );
    const reader = new PersistedConversationReader({ claudeConfigDir: () => dir! });
    const source = {
      agentId: "agent-1",
      provider: "claude",
      cwd: "/tmp/repo",
      persistence: { provider: "claude", sessionId: "session-1" },
      activityStamp: "1",
    };

    expect(await reader.readFirstUserMessage(source)).toBe("the very first prompt");
    // The tail window used for search does not reach the opening of a long transcript.
    const tail = await reader.read(source);
    expect(tail.some((message) => message.text === "the very first prompt")).toBe(false);
  });

  it("returns null without a persisted session", async () => {
    const reader = new PersistedConversationReader();
    expect(
      await reader.readFirstUserMessage({
        agentId: "agent-1",
        provider: "claude",
        cwd: "/tmp/repo",
        persistence: null,
        activityStamp: "1",
      }),
    ).toBeNull();
  });
});

describe("describe_workspace MCP tool", () => {
  it("defaults to the caller's workspace and honours excludeSelf", async () => {
    const { createPaseoToolCatalog } = await import("./tools/paseo-tools.js");
    const deps = createDeps({
      records: [
        storedRecord({ id: "caller", createdAt: "2026-10-27T08:00:00.000Z" }),
        storedRecord({ id: "sibling" }),
        storedRecord({ id: "elsewhere", workspaceId: OTHER_WORKSPACE_ID }),
      ],
    });
    const agentManager = Object.assign(deps.agentManager, {
      getAgent: (id: string) =>
        id === "caller" ? ({ id, workspaceId: WORKSPACE_ID } as ManagedAgent) : null,
    });
    const catalog = createPaseoToolCatalog({
      agentManager: agentManager as unknown as AgentManager,
      agentStorage: Object.assign(deps.agentStorage, {
        get: async () => null,
      }) as unknown as AgentStorage,
      providerSnapshotManager: {
        listRegisteredProviderIds: () => ["claude"],
      } as never,
      workspaceRegistry: deps.workspaceRegistry as never,
      callerAgentId: "caller",
      logger: createTestLogger(),
    });

    const all = await catalog.executeTool("describe_workspace", {});
    expect(
      (all.structuredContent as { agents: Array<{ id: string }> }).agents.map((a) => a.id),
    ).toEqual(["caller", "sibling"]);

    const others = await catalog.executeTool("describe_workspace", { excludeSelf: true });
    expect(others.structuredContent).toMatchObject({
      workspaceId: WORKSPACE_ID,
      title: "Workspace tabs",
      agents: [{ id: "sibling" }],
    });

    const listed = await catalog.executeTool("list_agents", { cwd: "/tmp" });
    expect(
      (listed.structuredContent as { agents: Array<{ id: string; workspaceId?: string }> }).agents
        .map((agent) => [agent.id, agent.workspaceId])
        .sort(),
    ).toEqual([
      ["caller", WORKSPACE_ID],
      ["elsewhere", OTHER_WORKSPACE_ID],
      ["sibling", WORKSPACE_ID],
    ]);
  });
});
