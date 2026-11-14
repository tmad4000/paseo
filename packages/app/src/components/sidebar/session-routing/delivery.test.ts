import { expect, test, vi } from "vitest";
import { AgentQueueDestinationChangedError } from "@getpaseo/client/internal/daemon-client";
import {
  deliverDirectRoutedPrompt,
  deliverRoutedPrompt,
  type DirectRouteDeliveryInput,
  type RouteDeliveryInput,
} from "./delivery";
import { AgentSnapshotPayloadSchema, type AgentQueueSnapshot } from "@getpaseo/protocol/messages";
const snapshot: AgentQueueSnapshot = {
  agentId: "chat",
  revision: 1,
  items: [{ id: "item", text: "hello", createdAt: "2026-10-01" }],
};
function fixture() {
  const events: string[] = [];
  let entry: import("@/stores/queue-outbox-store/model").PendingQueueEnqueue | undefined;
  const input: RouteDeliveryInput = {
    recipient: {
      serverId: "host",
      agentId: "chat",
      workspaceId: "workspace",
      projectId: "project",
      projectViewKey: "view",
      hostLabel: "M5",
      projectName: "Paseo",
      title: "CI",
      excerpt: "",
      confidence: 1,
    },
    itemId: "item",
    text: "  original\nverbatim  ",
    draftVersion: 7,
    isHostEligible: () => true,
    client: {
      enqueueAgentMessage: vi.fn(async () => {
        events.push("wire");
        return snapshot;
      }),
    },
    outbox: {
      getEntry: vi.fn(async () => entry),
      markRoutingDispatched: vi.fn(async () => {}),
      add: vi.fn(async (value) => {
        entry = { ...value, createdAt: 1, attempts: 0 };
        events.push("persist");
      }),
      acknowledge: vi.fn(async () => {
        events.push("ack");
        return true;
      }),
      removeDurably: vi.fn(async () => {
        entry = undefined;
        events.push("remove");
      }),
    },
    applySnapshot: vi.fn(),
  };
  return { input, events };
}
test("persists original prompt and destination before sending, then reports actual queue acknowledgement", async () => {
  const { input, events } = fixture();
  expect(await deliverRoutedPrompt(input)).toEqual({ queued: true });
  expect(events).toEqual(["persist", "wire", "ack", "remove"]);
  expect(input.client.enqueueAgentMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      text: input.text,
      itemId: "item",
      expectedWorkspaceId: "workspace",
      expectedProjectId: "project",
      routingDraftVersion: 7,
    }),
  );
  expect(input.client.enqueueAgentMessage).not.toHaveBeenCalledWith(
    expect.objectContaining({ interrupt: true }),
  );
});
test("storage failure never sends and uncertain delivery retains the durable item for same-ID retry", async () => {
  const { input } = fixture();
  const originalAdd = input.outbox.add;
  input.outbox.add = vi.fn(async () => {
    throw new Error("disk full");
  });
  await expect(deliverRoutedPrompt(input)).rejects.toThrow("disk full");
  expect(input.client.enqueueAgentMessage).not.toHaveBeenCalled();
  input.outbox.add = originalAdd;
  input.client.enqueueAgentMessage = vi.fn(async () => {
    throw new Error("ack lost");
  });
  await expect(deliverRoutedPrompt(input)).rejects.toThrow("ack lost");
  expect(input.outbox.removeDurably).not.toHaveBeenCalled();
  expect(input.outbox.acknowledge).not.toHaveBeenCalled();
  input.client.enqueueAgentMessage = vi.fn(async () => ({
    ...snapshot,
    items: [],
  }));
  expect(await deliverRoutedPrompt(input)).toEqual({ queued: false });
  expect(input.client.enqueueAgentMessage).toHaveBeenCalledWith(
    expect.objectContaining({ itemId: "item", text: input.text }),
  );
});
test("definitive destination rejection releases pending submission without claiming acknowledgement", async () => {
  const { input } = fixture();
  input.client.enqueueAgentMessage = vi.fn(async () => {
    throw new AgentQueueDestinationChangedError();
  });
  await expect(deliverRoutedPrompt(input)).rejects.toBeInstanceOf(
    AgentQueueDestinationChangedError,
  );
  expect(input.outbox.removeDurably).toHaveBeenCalledWith("item");
  expect(input.outbox.acknowledge).not.toHaveBeenCalled();
});

test("a retry racing completed background acknowledgement reports the receipt without another enqueue", async () => {
  const { input } = fixture();
  input.requireExisting = true;
  input.outbox.getAcknowledgement = () => ({ queued: false });
  expect(await deliverRoutedPrompt(input)).toEqual({ queued: false });
  expect(input.client.enqueueAgentMessage).not.toHaveBeenCalled();
  expect(input.outbox.add).not.toHaveBeenCalled();
});

function directFixture() {
  const agent = AgentSnapshotPayloadSchema.parse({
    id: "chat",
    provider: "codex",
    cwd: "/project",
    workspaceId: "workspace",
    model: null,
    createdAt: "2026-10-01",
    updatedAt: "2026-10-01",
    lastUserMessageAt: null,
    status: "idle",
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    title: "CI",
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: false,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    },
  });
  const input: DirectRouteDeliveryInput = {
    recipient: fixture().input.recipient,
    text: "  exact\nprompt  ",
    mode: "steer",
    client: {
      fetchAgent: vi.fn(async () => ({ agent, project: null })),
      sendAgentMessage: vi.fn(async () => undefined),
      uploadFile: vi.fn(async () => ({
        requestId: "unused",
        file: null,
        error: null,
      })),
    },
    submission: {
      begin: vi.fn(),
      accept: vi.fn(),
      reject: vi.fn((): "rejected" => "rejected"),
    },
    isHostEligible: () => true,
    isDestinationCurrent: () => true,
    supportsSteerOnly: () => true,
    getTurn: () => ({ isActive: true, turnId: "turn" }),
  };
  return { input, agent };
}

test("direct steering validates the destination and preserves text with strict non-interrupting behavior", async () => {
  const { input } = directFixture();
  expect(await deliverDirectRoutedPrompt(input)).toEqual({ queued: false });
  expect(input.client.fetchAgent).toHaveBeenCalledWith("chat");
  expect(input.client.sendAgentMessage).toHaveBeenCalledExactlyOnceWith("chat", input.text, {
    messageId: expect.any(String),
    activeTurnBehavior: "steer_only",
    images: [],
    attachments: [],
  });
  expect(input.submission.begin).toHaveBeenCalledWith(
    "chat",
    expect.objectContaining({ turnId: "turn" }),
  );
  expect(input.submission.accept).toHaveBeenCalledOnce();
  expect(input.submission.reject).not.toHaveBeenCalled();
});

test.each([true, false])(
  "explicit interrupt marks only an active turn (active=%s)",
  async (isActive) => {
    const { input } = directFixture();
    input.mode = "interrupt";
    input.getTurn = () => ({ isActive, turnId: null });
    await deliverDirectRoutedPrompt(input);
    expect(input.client.sendAgentMessage).toHaveBeenCalledExactlyOnceWith("chat", input.text, {
      messageId: expect.any(String),
      activeTurnBehavior: "interrupt",
      images: [],
      attachments: [],
      ...(isActive ? { interrupt: true } : {}),
    });
  },
);

test("an old host cannot silently turn active steering into interrupt, but allows idle sends", async () => {
  const { input } = directFixture();
  input.supportsSteerOnly = () => false;
  await expect(deliverDirectRoutedPrompt(input)).rejects.toMatchObject({
    reason: "steerUnsupported",
  });
  expect(input.client.sendAgentMessage).not.toHaveBeenCalled();
  input.getTurn = () => ({ isActive: false, turnId: null });
  await deliverDirectRoutedPrompt(input);
  expect(input.client.sendAgentMessage).toHaveBeenCalledExactlyOnceWith("chat", input.text, {
    messageId: expect.any(String),
    activeTurnBehavior: undefined,
    images: [],
    attachments: [],
  });
});

test.each(["moved", "archived", "missing", "project changed", "host excluded"])(
  "direct delivery rejects a destination that became %s during preflight",
  async (change) => {
    const { input, agent } = directFixture();
    input.client.fetchAgent = vi.fn(async () => {
      if (change === "moved") agent.workspaceId = "other";
      if (change === "archived") agent.archivedAt = "2026-10-05";
      if (change === "project changed") input.isDestinationCurrent = () => false;
      if (change === "host excluded") input.isHostEligible = () => false;
      return change === "missing" ? null : { agent, project: null };
    });
    await expect(deliverDirectRoutedPrompt(input)).rejects.toThrow();
    expect(input.client.sendAgentMessage).not.toHaveBeenCalled();
    expect(input.submission.accept).not.toHaveBeenCalled();
  },
);

test("a lost direct acknowledgement rejects without resending or claiming delivery", async () => {
  const { input } = directFixture();
  input.client.sendAgentMessage = vi.fn(async () => {
    throw new Error("ack lost");
  });
  await expect(deliverDirectRoutedPrompt(input)).rejects.toMatchObject({
    reason: "uncertain",
    message:
      "Delivery could not be confirmed. Check the destination conversation before sending again.",
    cause: new Error("ack lost"),
  });
  expect(input.client.sendAgentMessage).toHaveBeenCalledOnce();
  expect(input.submission.accept).not.toHaveBeenCalled();
  expect(input.submission.reject).toHaveBeenCalledOnce();
  expect(input.text).toBe("  exact\nprompt  ");
});
