import { describe, expect, it } from "vitest";
import {
  agentSender,
  getSenderAgentId,
  parseUserMessageSender,
  resolveAgentCreatedBy,
} from "./user-message-sender.js";

describe("user message sender", () => {
  it("parses the known kinds and rejects anything else", () => {
    expect(parseUserMessageSender("human")).toBe("human");
    expect(parseUserMessageSender("schedule")).toBe("schedule");
    expect(parseUserMessageSender("agent:abc")).toBe("agent:abc");
    expect(parseUserMessageSender("agent:")).toBeNull();
    expect(parseUserMessageSender("robot")).toBeNull();
    expect(parseUserMessageSender(undefined)).toBeNull();
  });

  it("reads the agent id from an agent sender", () => {
    expect(getSenderAgentId(agentSender("parent-1"))).toBe("parent-1");
    expect(getSenderAgentId("human")).toBeNull();
  });

  it("treats legacy agents as human-created unless they carry a parent", () => {
    expect(resolveAgentCreatedBy({})).toBe("human");
    expect(resolveAgentCreatedBy({ parentAgentId: "parent-1" })).toBe("agent:parent-1");
    expect(resolveAgentCreatedBy({ createdBy: "schedule", parentAgentId: "parent-1" })).toBe(
      "schedule",
    );
  });
});
