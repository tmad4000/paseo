import { describe, expect, it } from "vitest";
import type { AgentSnapshotPayload, WorkspaceDescription } from "@getpaseo/protocol/messages";
import { PARENT_AGENT_ID_LABEL } from "@getpaseo/protocol/agent-labels";
import { renderWorkspaceDescription, resolveDescribeTarget } from "./describe.js";
import { toListItem } from "../agent/ls.js";

describe("resolveDescribeTarget", () => {
  it("uses an explicit workspace id", async () => {
    await expect(
      resolveDescribeTarget(" wks_1 ", async () => "unused", { PASEO_AGENT_ID: "agent-1" }),
    ).resolves.toEqual({ workspaceId: "wks_1", callerAgentId: "agent-1" });
  });

  it("falls back to the calling agent's workspace", async () => {
    await expect(
      resolveDescribeTarget(undefined, async (id) => (id === "agent-1" ? "wks_mine" : null), {
        PASEO_AGENT_ID: "agent-1",
      }),
    ).resolves.toEqual({ workspaceId: "wks_mine", callerAgentId: "agent-1" });
  });

  it("asks for an id outside an agent shell", async () => {
    await expect(resolveDescribeTarget(undefined, async () => null, {})).rejects.toMatchObject({
      code: "MISSING_WORKSPACE",
    });
  });
});

describe("renderWorkspaceDescription", () => {
  const description: WorkspaceDescription = {
    workspaceId: "wks_1",
    title: "Tabs",
    cwd: "/tmp/repo",
    generatedAt: "2026-10-27T12:00:00.000Z",
    agents: [
      {
        id: "abcdef1234",
        title: "Review",
        provider: "claude",
        model: "opus",
        status: "idle",
        createdAt: "2026-10-27T10:00:00.000Z",
        updatedAt: "2026-10-27T11:00:00.000Z",
        lastUserMessageAt: null,
        labels: {},
        parentAgentId: "1234567890",
        focus: {
          firstUserMessage: "Review the PR",
          lastUserMessage: null,
          lastAssistantMessage: null,
          summary: 'Started with "Review the PR".',
        },
        openAsks: [],
        pins: [],
      },
    ],
  };

  it("prints one block per chat with its focus summary", () => {
    expect(renderWorkspaceDescription(description)).toBe(
      "Tabs (wks_1)  /tmp/repo\n\n" +
        "abcdef1  Review  [idle]  claude/opus  subagent of 1234567\n" +
        '  Started with "Review the PR".',
    );
  });

  it("says when the workspace has no other chats", () => {
    expect(renderWorkspaceDescription({ ...description, agents: [] })).toContain(
      "No other chats in this workspace.",
    );
  });
});

describe("paseo ls JSON rows", () => {
  it("include workspaceId and parentAgentId", () => {
    const item = toListItem({
      id: "agent-123456",
      provider: "claude",
      cwd: "/tmp/repo",
      workspaceId: "wks_1",
      model: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "idle",
      title: "Child",
      labels: { [PARENT_AGENT_ID_LABEL]: "parent-1" },
    } as unknown as AgentSnapshotPayload);
    expect(item).toMatchObject({ workspaceId: "wks_1", parentAgentId: "parent-1" });
  });
});
