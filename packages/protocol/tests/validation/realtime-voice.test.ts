import { describe, expect, it } from "vitest";
import { SessionInboundMessageSchema, SessionOutboundMessageSchema } from "../../src/messages.js";
import { WSOutboundMessageSchema } from "../../src/generated/validation/ws-outbound.aot.js";

const state = {
  provider: "openai-realtime",
  destination: "assistant",
  connection: "connected",
  mode: "listen",
  epoch: "epoch",
  draft: "first paragraph",
  muted: false,
  error: null,
  omittedContextEntries: 0,
};
describe("optional Realtime protocol", () => {
  it("retains existing voice start and input-state messages", () => {
    expect(
      SessionInboundMessageSchema.safeParse({
        type: "set_voice_mode",
        enabled: true,
        agentId: "11111111-1111-4111-8111-111111111111",
        requestId: "start",
      }).success,
    ).toBe(true);
    expect(
      SessionOutboundMessageSchema.safeParse({
        type: "voice_input_state",
        payload: { isSpeaking: false },
      }).success,
    ).toBe(true);
  });
  it("accepts scoped controls and rejects missing attachment ownership", () => {
    const request = {
      type: "voice.realtime.control.request",
      action: "clear",
      attachmentId: "attachment",
      generation: "generation",
      expectedEpoch: "epoch",
      requestId: "request",
    };
    expect(SessionInboundMessageSchema.safeParse(request).success).toBe(true);
    expect(
      SessionInboundMessageSchema.safeParse({ ...request, generation: undefined }).success,
    ).toBe(false);
  });
  it("generated client validation carries complete provider and privacy state", () => {
    for (const message of [
      { type: "voice_input_state", payload: { isSpeaking: false, realtime: state } },
      {
        type: "voice.realtime.control.response",
        payload: { requestId: "request", state, error: null },
      },
    ]) {
      const envelope = { type: "session", message };
      expect(WSOutboundMessageSchema.safeParse(envelope)).toEqual({
        success: true,
        data: envelope,
      });
    }
    expect(
      WSOutboundMessageSchema.safeParse({
        type: "session",
        message: {
          type: "voice_input_state",
          payload: { isSpeaking: false, realtime: { ...state, muted: "yes" } },
        },
      }).success,
    ).toBe(false);
  });
});
