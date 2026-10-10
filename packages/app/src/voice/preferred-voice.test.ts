import { describe, expect, it, vi } from "vitest";
import { startPreferredVoice } from "./preferred-voice";

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
