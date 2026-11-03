import { describe, expect, it } from "vitest";
import {
  agentDelegatorId,
  agentHumanMessageAt,
  formatDelegatorName,
  isMineAgent,
  type AgentOwnershipInput,
} from "./agent-ownership";

function agent(input: Partial<AgentOwnershipInput>): AgentOwnershipInput {
  return { parentAgentId: null, lastUserMessageAt: null, ...input };
}

const activity = (lastHumanMessageAt: string | null) => ({
  lastUserMessageAt: "2026-05-02T00:00:00.000Z",
  lastAssistantMessageAt: null,
  lastHumanMessageAt,
});

describe("Mine predicate", () => {
  it("counts agents a person created", () => {
    expect(isMineAgent(agent({ createdBy: "human", messageActivity: activity(null) }))).toBe(true);
  });

  it("counts a delegated or scheduled agent only once a person sent it a turn", () => {
    expect(isMineAgent(agent({ createdBy: "agent:parent", messageActivity: activity(null) }))).toBe(
      false,
    );
    expect(isMineAgent(agent({ createdBy: "schedule", messageActivity: activity(null) }))).toBe(
      false,
    );
    expect(
      isMineAgent(
        agent({ createdBy: "agent:parent", messageActivity: activity("2026-05-01T00:00:00Z") }),
      ),
    ).toBe(true);
  });

  it("treats agents from hosts without createdBy as human-created unless they have a parent", () => {
    expect(isMineAgent(agent({}))).toBe(true);
    expect(isMineAgent(agent({ parentAgentId: "parent" }))).toBe(false);
  });

  it("falls back to the last user message on hosts without human activity", () => {
    const legacy = {
      lastUserMessageAt: "2026-05-02T00:00:00.000Z",
      lastAssistantMessageAt: null,
    };
    expect(agentHumanMessageAt(agent({ messageActivity: legacy }))?.toISOString()).toBe(
      "2026-05-02T00:00:00.000Z",
    );
    expect(agentHumanMessageAt(agent({ parentAgentId: "p", messageActivity: legacy }))).toBeNull();
  });
});

describe("delegated by", () => {
  it("names the parent label first, then a recorded agent creator", () => {
    expect(agentDelegatorId({ parentAgentId: "parent", createdBy: "agent:other" })).toBe("parent");
    expect(agentDelegatorId({ parentAgentId: null, createdBy: "agent:handoff" })).toBe("handoff");
    expect(agentDelegatorId({ parentAgentId: null, createdBy: "human" })).toBeNull();
    expect(agentDelegatorId({ parentAgentId: null, createdBy: "schedule" })).toBeNull();
  });

  it("uses the parent title, or the short id when the title is unknown", () => {
    expect(formatDelegatorName({ delegatorId: "abcdef123456", delegatorTitle: "Planner" })).toBe(
      "Planner",
    );
    expect(formatDelegatorName({ delegatorId: "abcdef123456", delegatorTitle: "  " })).toBe(
      "abcdef1",
    );
    expect(formatDelegatorName({ delegatorId: "abcdef123456", delegatorTitle: undefined })).toBe(
      "abcdef1",
    );
  });
});
