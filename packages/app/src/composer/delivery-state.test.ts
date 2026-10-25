import { describe, expect, it } from "vitest";

import {
  needsDirectSendAttention,
  resolveChatMessageDeliveryState,
  resolveQueuedMessageDeliveryState,
} from "./delivery-state";
import { QUEUE_OUTBOX_MAX_ATTEMPTS } from "@/stores/queue-outbox-store/model";
import { SEND_OUTBOX_MAX_ATTEMPTS } from "@/stores/send-outbox-store/model";

describe("resolveChatMessageDeliveryState", () => {
  it("shows a fresh optimistic bubble as saved on the device", () => {
    expect(resolveChatMessageDeliveryState({ isCanonical: false })).toBe("pending");
    expect(
      resolveChatMessageDeliveryState({
        isCanonical: false,
        submission: { rpcSettled: false },
        outboxEntry: { attempts: 0 },
      }),
    ).toBe("pending");
  });

  it("shows one tick once the host accepted the send", () => {
    expect(
      resolveChatMessageDeliveryState({ isCanonical: false, submission: { rpcSettled: true } }),
    ).toBe("accepted");
  });

  it("shows delivered once the agent's timeline echoes the message", () => {
    expect(
      resolveChatMessageDeliveryState({ isCanonical: true, submission: { rpcSettled: false } }),
    ).toBe("delivered");
    expect(resolveChatMessageDeliveryState({ isCanonical: true })).toBe("delivered");
  });

  it("asks for attention after repeated failures or a refusal", () => {
    expect(
      resolveChatMessageDeliveryState({
        isCanonical: false,
        submission: { rpcSettled: false },
        outboxEntry: { attempts: SEND_OUTBOX_MAX_ATTEMPTS },
      }),
    ).toBe("attention");
    expect(
      resolveChatMessageDeliveryState({
        isCanonical: false,
        outboxEntry: { attempts: 0, rejectedError: "Agent not found" },
      }),
    ).toBe("attention");
  });

  it("keeps retrying silently below the alert threshold", () => {
    expect(needsDirectSendAttention({ attempts: SEND_OUTBOX_MAX_ATTEMPTS - 1 })).toBe(false);
  });
});

describe("resolveQueuedMessageDeliveryState", () => {
  it("shows an unacknowledged queued row as saved on the device", () => {
    expect(
      resolveQueuedMessageDeliveryState({ outboxEntry: { attempts: 1 }, inHostQueue: false }),
    ).toBe("pending");
  });

  it("shows one tick when the host queue holds the item", () => {
    expect(resolveQueuedMessageDeliveryState({ inHostQueue: true })).toBe("accepted");
    // The acknowledgement can race the local outbox cleanup.
    expect(
      resolveQueuedMessageDeliveryState({ outboxEntry: { attempts: 0 }, inHostQueue: true }),
    ).toBe("accepted");
  });

  it("asks for attention once retries pass the alert threshold", () => {
    expect(
      resolveQueuedMessageDeliveryState({
        outboxEntry: { attempts: QUEUE_OUTBOX_MAX_ATTEMPTS },
        inHostQueue: false,
      }),
    ).toBe("attention");
  });
});
