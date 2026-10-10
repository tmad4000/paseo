import { describe, expect, it, vi } from "vitest";
import {
  resolveCanCreateAgentForVoice,
  startPreferredVoice,
  startPreferredVoiceForNewAgent,
} from "./preferred-voice";

describe("startPreferredVoice", () => {
  it("starts GPT realtime unmuted when the host offers it", async () => {
    const startVoice = vi.fn().mockResolvedValue(undefined);
    const result = await startPreferredVoice({
      startVoice,
      serverId: "s1",
      agentId: "a1",
      preferRealtimeGpt: true,
    });
    expect(startVoice).toHaveBeenCalledTimes(1);
    expect(startVoice).toHaveBeenCalledWith("s1", "a1", "openai-realtime", false);
    expect(result).toEqual({ provider: "openai-realtime", realtimeError: null });
  });

  it("starts Paseo voice when the host does not offer GPT realtime", async () => {
    const startVoice = vi.fn().mockResolvedValue(undefined);
    const result = await startPreferredVoice({
      startVoice,
      serverId: "s1",
      agentId: "a1",
      preferRealtimeGpt: false,
    });
    expect(startVoice).toHaveBeenCalledTimes(1);
    expect(startVoice).toHaveBeenCalledWith("s1", "a1", "paseo");
    expect(result).toEqual({ provider: "paseo", realtimeError: null });
  });

  it("falls back to Paseo voice when the GPT realtime start fails", async () => {
    const startVoice = vi
      .fn()
      .mockRejectedValueOnce(new Error("Configure the host OpenAI credential"))
      .mockResolvedValueOnce(undefined);
    const result = await startPreferredVoice({
      startVoice,
      serverId: "s1",
      agentId: "a1",
      preferRealtimeGpt: true,
    });
    expect(startVoice).toHaveBeenNthCalledWith(1, "s1", "a1", "openai-realtime", false);
    expect(startVoice).toHaveBeenNthCalledWith(2, "s1", "a1", "paseo");
    expect(result).toEqual({
      provider: "paseo",
      realtimeError: "Configure the host OpenAI credential",
    });
  });

  it("propagates the Paseo failure when both providers fail", async () => {
    const startVoice = vi
      .fn()
      .mockRejectedValueOnce(new Error("realtime down"))
      .mockRejectedValueOnce(new Error("no speech providers"));
    await expect(
      startPreferredVoice({
        startVoice,
        serverId: "s1",
        agentId: "a1",
        preferRealtimeGpt: true,
      }),
    ).rejects.toThrow("no speech providers");
  });
});

describe("startPreferredVoiceForNewAgent", () => {
  it("creates the agent, then starts GPT realtime on it", async () => {
    const calls: string[] = [];
    const createAgent = vi.fn(async () => {
      calls.push("create");
      return "agent-new";
    });
    const startVoice = vi.fn(async () => {
      calls.push("voice");
    });
    const result = await startPreferredVoiceForNewAgent({
      createAgent,
      startVoice,
      serverId: "s1",
      preferRealtimeGpt: true,
    });
    expect(calls).toEqual(["create", "voice"]);
    expect(startVoice).toHaveBeenCalledWith("s1", "agent-new", "openai-realtime", false);
    expect(result).toEqual({
      agentId: "agent-new",
      provider: "openai-realtime",
      realtimeError: null,
    });
  });

  it("keeps the Paseo fallback for the newly created agent", async () => {
    const startVoice = vi
      .fn()
      .mockRejectedValueOnce(new Error("connect timeout"))
      .mockResolvedValueOnce(undefined);
    const result = await startPreferredVoiceForNewAgent({
      createAgent: async () => "agent-new",
      startVoice,
      serverId: "s1",
      preferRealtimeGpt: true,
    });
    expect(startVoice).toHaveBeenLastCalledWith("s1", "agent-new", "paseo");
    expect(result).toEqual({
      agentId: "agent-new",
      provider: "paseo",
      realtimeError: "connect timeout",
    });
  });

  it("starts no voice when no agent was created", async () => {
    const startVoice = vi.fn();
    const result = await startPreferredVoiceForNewAgent({
      createAgent: async () => null,
      startVoice,
      serverId: "s1",
      preferRealtimeGpt: true,
    });
    expect(result).toBeNull();
    expect(startVoice).not.toHaveBeenCalled();
  });

  it("propagates an agent creation failure without starting voice", async () => {
    const startVoice = vi.fn();
    await expect(
      startPreferredVoiceForNewAgent({
        createAgent: async () => {
          throw new Error("Select a model");
        },
        startVoice,
        serverId: "s1",
        preferRealtimeGpt: false,
      }),
    ).rejects.toThrow("Select a model");
    expect(startVoice).not.toHaveBeenCalled();
  });
});

describe("resolveCanCreateAgentForVoice", () => {
  const base = {
    hasAgent: false,
    canCreateAgent: true,
    isSubmitLoading: false,
    hasSendableContent: false,
  };

  it("offers voice on an empty, idle draft", () => {
    expect(resolveCanCreateAgentForVoice(base)).toBe(true);
  });

  it("does not create an agent when one already exists", () => {
    expect(resolveCanCreateAgentForVoice({ ...base, hasAgent: true })).toBe(false);
  });

  it("is off for composers that cannot create an agent", () => {
    expect(resolveCanCreateAgentForVoice({ ...base, canCreateAgent: false })).toBe(false);
  });

  it("keeps typed content on the normal send path", () => {
    expect(resolveCanCreateAgentForVoice({ ...base, hasSendableContent: true })).toBe(false);
  });

  it("waits while the draft is already being created", () => {
    expect(resolveCanCreateAgentForVoice({ ...base, isSubmitLoading: true })).toBe(false);
  });
});
