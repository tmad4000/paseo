import { describe, expect, it, vi } from "vitest";
import type { MessagePayload } from "@/composer/types";
import {
  resolveCanCreateAgentForVoice,
  startPreferredVoiceForNewAgent,
} from "@/voice/preferred-voice";
import {
  createNewWorkspaceAgentForVoice,
  resolveNewWorkspaceSubmissionKind,
} from "./new-workspace-voice";

function payload(overrides: Partial<MessagePayload> = {}): MessagePayload {
  return { text: "", attachments: [], cwd: "/repo", ...overrides };
}

describe("resolveNewWorkspaceSubmissionKind", () => {
  it("keeps an empty typed submit as a workspace-only create", () => {
    expect(resolveNewWorkspaceSubmissionKind(payload(), { forVoice: false })).toBe(
      "empty-workspace",
    );
  });

  it("creates a chat agent for a typed prompt", () => {
    expect(resolveNewWorkspaceSubmissionKind(payload({ text: "hi" }), { forVoice: false })).toBe(
      "chat-agent",
    );
  });

  it("always creates an agent for a voice start, even with no text", () => {
    // Regression: an empty voice start fell into the workspace-only path, leaving voice with
    // no agent until a first message had been sent.
    expect(resolveNewWorkspaceSubmissionKind(payload(), { forVoice: true })).toBe("chat-agent");
  });
});

describe("createNewWorkspaceAgentForVoice", () => {
  it("creates the agent with an empty prompt in the selected directory and returns its id", async () => {
    const createChatAgent = vi.fn().mockResolvedValue({ agentId: "agent-1" });
    await expect(createNewWorkspaceAgentForVoice({ cwd: "/repo", createChatAgent })).resolves.toBe(
      "agent-1",
    );
    expect(createChatAgent).toHaveBeenCalledTimes(1);
    expect(createChatAgent).toHaveBeenCalledWith({ text: "", attachments: [], cwd: "/repo" });
  });

  it("uses the composer's empty cwd when no source directory is selected yet", async () => {
    const createChatAgent = vi.fn().mockResolvedValue({ agentId: "agent-1" });
    await createNewWorkspaceAgentForVoice({ cwd: null, createChatAgent });
    expect(createChatAgent).toHaveBeenCalledWith({ text: "", attachments: [], cwd: "" });
  });

  it("returns null when creation failed, so voice is not started", async () => {
    const createChatAgent = vi.fn().mockResolvedValue(null);
    await expect(
      createNewWorkspaceAgentForVoice({ cwd: "/repo", createChatAgent }),
    ).resolves.toBeNull();
  });
});

describe("new-session voice start before any message", () => {
  it("offers voice on an empty new-session composer once it can create an agent", () => {
    expect(
      resolveCanCreateAgentForVoice({
        hasAgent: false,
        canCreateAgent: true,
        isSubmitLoading: false,
        hasSendableContent: false,
      }),
    ).toBe(true);
  });

  it("starts voice on the agent created for the new session, without sending a message", async () => {
    const createChatAgent = vi.fn().mockResolvedValue({ agentId: "agent-1" });
    const startVoice = vi.fn().mockResolvedValue(undefined);
    const result = await startPreferredVoiceForNewAgent({
      startVoice,
      serverId: "s1",
      preferRealtimeGpt: true,
      createAgent: () => createNewWorkspaceAgentForVoice({ cwd: "/repo", createChatAgent }),
    });
    expect(createChatAgent).toHaveBeenCalledWith(expect.objectContaining({ text: "" }));
    expect(startVoice).toHaveBeenCalledWith("s1", "agent-1", "openai-realtime", false);
    expect(result).toEqual({
      provider: "openai-realtime",
      realtimeError: null,
      agentId: "agent-1",
    });
  });

  it("does not start voice when the new session's agent could not be created", async () => {
    const startVoice = vi.fn();
    const result = await startPreferredVoiceForNewAgent({
      startVoice,
      serverId: "s1",
      preferRealtimeGpt: true,
      createAgent: () =>
        createNewWorkspaceAgentForVoice({
          cwd: "/repo",
          createChatAgent: vi.fn().mockResolvedValue(null),
        }),
    });
    expect(result).toBeNull();
    expect(startVoice).not.toHaveBeenCalled();
  });
});
