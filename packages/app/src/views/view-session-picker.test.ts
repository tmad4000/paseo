import { describe, expect, it } from "vitest";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import {
  buildViewSessionPickerRows,
  filterViewSessionPickerRows,
} from "@/views/view-session-picker";

function agent(overrides: Partial<AggregatedAgent>): AggregatedAgent {
  return {
    id: "agent",
    serverId: "host-a",
    serverLabel: "Mac mini",
    title: "Agent",
    status: "idle",
    cwd: "/code/alpha",
    workspaceId: "ws-alpha",
    lastActivityAt: new Date(0),
    createdAt: new Date(0),
    archivedAt: null,
    requiresAttention: false,
    ...overrides,
  } as AggregatedAgent;
}

describe("view session picker rows", () => {
  const workspaceLabelByKey = new Map([
    ["host-a:ws-alpha", "alpha · main"],
    ["host-b:ws-beta", "beta · feature"],
  ]);

  it("lists workspace agents with project labels and skips archived or unplaced ones", () => {
    const rows = buildViewSessionPickerRows({
      agents: [
        agent({ id: "a1", title: "Fix login" }),
        agent({ id: "b1", serverId: "host-b", serverLabel: "Laptop", workspaceId: "ws-beta" }),
        agent({ id: "archived", archivedAt: new Date(1) }),
        agent({ id: "loose", workspaceId: undefined }),
      ],
      workspaceLabelByKey,
      showHost: true,
      untitledLabel: "New agent",
    });
    expect(rows.map((row) => [row.agent.id, row.subtitle])).toEqual([
      ["a1", "a1 · Mac mini · alpha · main"],
      ["b1", "b1 · Laptop · beta · feature"],
    ]);
  });

  it("matches every search term across title, project and host", () => {
    const rows = buildViewSessionPickerRows({
      agents: [
        agent({ id: "a1", title: "Fix login" }),
        agent({ id: "b1", title: "Fix tests", serverId: "host-b", workspaceId: "ws-beta" }),
      ],
      workspaceLabelByKey,
      showHost: false,
      untitledLabel: "New agent",
    });
    expect(filterViewSessionPickerRows(rows, "fix beta").map((row) => row.agent.id)).toEqual([
      "b1",
    ]);
    expect(filterViewSessionPickerRows(rows, "  ").map((row) => row.agent.id)).toEqual([
      "a1",
      "b1",
    ]);
  });

  it("names provider and short id, finds a pasted id, and can stay on one host", () => {
    const id = "9b8394eb-de93-4c1a-8f3e-0123456789ab";
    const rows = buildViewSessionPickerRows({
      agents: [
        agent({ id, title: "Release orchestrator", provider: "claude" }),
        agent({ id: "b1", serverId: "host-b", serverLabel: "Laptop", workspaceId: "ws-beta" }),
      ],
      workspaceLabelByKey,
      showHost: false,
      untitledLabel: "New agent",
      serverId: "host-a",
    });
    expect(rows.map((row) => row.subtitle)).toEqual(["claude · 9b8394eb · alpha · main"]);
    expect(filterViewSessionPickerRows(rows, "9b8394eb").map((row) => row.agent.id)).toEqual([id]);
    expect(filterViewSessionPickerRows(rows, id).map((row) => row.agent.id)).toEqual([id]);
  });
});
