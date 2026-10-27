import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentReadMarkKey, useAgentReadMarksStore } from "@/stores/agent-read-marks-store";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { markAgentRead, markAgentReadLocally } from "@/workspace/mark-read";

const SERVER_ID = "mark-read-test";

function agent(input: Partial<Agent> & Pick<Agent, "id">): Agent {
  return {
    serverId: SERVER_ID,
    provider: "codex",
    status: "idle",
    turn: { phase: "idle", cancellationRequestId: null },
    createdAt: new Date(0),
    updatedAt: new Date(0),
    lastUserMessageAt: null,
    lastActivityAt: new Date(1_000),
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: false,
      supportsMcpServers: false,
      supportsReasoningStream: false,
      supportsToolInvocations: false,
    },
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    title: null,
    cwd: "/repo",
    model: null,
    parentAgentId: null,
    labels: {},
    ...input,
  };
}

function seedAgents(agents: Agent[]): void {
  useSessionStore
    .getState()
    .setAgents(SERVER_ID, () => new Map(agents.map((entry) => [entry.id, entry])));
}

function readThrough(agentId: string): number | undefined {
  return useAgentReadMarksStore
    .getState()
    .readThroughByAgentKey.get(agentReadMarkKey(SERVER_ID, agentId));
}

function recordingClient() {
  const clearAgentAttention = vi.fn<DaemonClient["clearAgentAttention"]>(async () => {});
  return { clearAgentAttention };
}

beforeEach(() => {
  useSessionStore.getState().initializeSession(SERVER_ID, {} as DaemonClient);
});

afterEach(() => {
  useSessionStore.setState((state) => ({ ...state, sessions: {}, agentLastActivity: new Map() }));
  useAgentReadMarksStore.setState({ readThroughByAgentKey: new Map() });
});

describe("markAgentRead", () => {
  it("clears finished attention on the host and reads the tab through current activity", async () => {
    seedAgents([agent({ id: "a", requiresAttention: true, attentionReason: "finished" })]);
    const client = recordingClient();

    await markAgentRead({ serverId: SERVER_ID, agentId: "a", client });

    expect(client.clearAgentAttention).toHaveBeenCalledWith("a");
    expect(readThrough("a")).toBe(1_000);
  });

  it("clears error attention too", async () => {
    seedAgents([agent({ id: "a", requiresAttention: true, attentionReason: "error" })]);
    const client = recordingClient();

    await markAgentRead({ serverId: SERVER_ID, agentId: "a", client });

    expect(client.clearAgentAttention).toHaveBeenCalledWith("a");
  });

  it("never clears a pending permission, but still reads the tab dot", async () => {
    seedAgents([agent({ id: "a", requiresAttention: true, attentionReason: "permission" })]);
    const client = recordingClient();

    await markAgentRead({ serverId: SERVER_ID, agentId: "a", client });

    expect(client.clearAgentAttention).not.toHaveBeenCalled();
    expect(readThrough("a")).toBe(1_000);
  });

  it("reads only the tab dot when the host holds no attention", async () => {
    seedAgents([agent({ id: "a", status: "running" })]);
    const client = recordingClient();

    await markAgentRead({ serverId: SERVER_ID, agentId: "a", client });

    expect(client.clearAgentAttention).not.toHaveBeenCalled();
    expect(readThrough("a")).toBe(1_000);
  });

  it("fails when the host is disconnected and attention needs clearing", async () => {
    seedAgents([agent({ id: "a", requiresAttention: true, attentionReason: "finished" })]);

    await expect(
      markAgentRead({ serverId: SERVER_ID, agentId: "a", client: null }),
    ).rejects.toThrow();
  });
});

describe("markAgentReadLocally", () => {
  it("reads through the newest live activity, and newer activity is not covered", () => {
    seedAgents([agent({ id: "a" })]);
    useSessionStore.setState((state) => ({
      ...state,
      agentLastActivity: new Map([["a", new Date(2_000)]]),
    }));

    markAgentReadLocally({ serverId: SERVER_ID, agentId: "a" });
    expect(readThrough("a")).toBe(2_000);

    useSessionStore.setState((state) => ({
      ...state,
      agentLastActivity: new Map([["a", new Date(1_500)]]),
    }));
    markAgentReadLocally({ serverId: SERVER_ID, agentId: "a" });
    expect(readThrough("a")).toBe(2_000);
  });
});
