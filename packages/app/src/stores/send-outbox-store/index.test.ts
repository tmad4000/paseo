import { beforeAll, describe, expect, it, vi } from "vitest";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { SendOutboxFlushClient } from "./model";

const storage = vi.hoisted(() => ({
  values: new Map<string, string>(),
  readHold: undefined as Promise<void> | undefined,
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => {
      await storage.readHold;
      return storage.values.get(key) ?? null;
    },
    setItem: async (key: string, value: string) => {
      storage.values.set(key, value);
    },
    removeItem: async (key: string) => {
      storage.values.delete(key);
    },
  },
}));

// Warm the real dependency graph outside timed cold-storage assertions. Each scenario
// still resets modules before creating the store, so hydration is exercised afresh.
beforeAll(async () => {
  await import("./index");
}, 30_000);

const SAVED = {
  state: {
    entries: {
      "msg-1": {
        serverId: "server",
        agentId: "agent",
        clientMessageId: "msg-1",
        text: "saved before the app was killed",
        images: [],
        attachments: [],
        activeTurnBehavior: "steer_only" as const,
        createdAt: 1,
        attempts: 0,
      },
    },
  },
  version: 1,
};

describe("send outbox persistence", () => {
  // Regression: remembering host support at connect time ran set() before the
  // store rehydrated, and persist overwrote the saved entries with {}.
  it("keeps saved entries when host support is recorded during a slow cold start", async () => {
    storage.values.set("paseo-send-outbox", JSON.stringify(SAVED));
    let releaseRead!: () => void;
    storage.readHold = new Promise((resolve) => {
      releaseRead = resolve;
    });
    vi.resetModules();
    const { useSendOutboxStore } = await import("./index");

    const remembered = useSendOutboxStore.getState().rememberHostSupport("server", true);
    releaseRead();
    await remembered;

    const persisted = JSON.parse(storage.values.get("paseo-send-outbox") ?? "{}");
    expect(Object.keys(persisted.state.entries)).toEqual(["msg-1"]);
    expect(persisted.state.durableHosts).toEqual({ server: true });
    expect(useSendOutboxStore.getState().entries["msg-1"]?.text).toBe(
      "saved before the app was killed",
    );
  });
});

async function setupLiveSend() {
  storage.values.clear();
  storage.readHold = undefined;
  vi.resetModules();
  const { useSessionStore, selectAgentTurnPresentation } = await import("@/stores/session-store");
  const { createMessageSubmissionWriter } = await import("@/composer/submission/writer");
  const { createDirectSendOutbox } = await import("@/composer/submission/direct-send-outbox");
  const { flushSendOutboxForServer, useSendOutboxStore, canEditRefusedSend } =
    await import("./index");
  const { retryDirectSend } = await import("@/composer/delivery-actions");
  useSessionStore.getState().clearSession("server");
  const session = useSessionStore.getState();
  session.initializeSession("server", null as unknown as DaemonClient);
  session.updateSessionServerInfo("server", {
    serverId: "server",
    hostname: null,
    version: "1.0.0",
    features: {
      canonicalSubmittedPrompts: true,
      agentRequestReceipts: true,
      agentMessageQueue: true,
    },
  });
  const entry = SAVED.state.entries["msg-1"];
  await useSendOutboxStore.getState().add(entry);
  createMessageSubmissionWriter("server").begin("agent", {
    kind: "user_message",
    id: entry.clientMessageId,
    clientMessageId: entry.clientMessageId,
    text: entry.text,
    timestamp: new Date(0),
  });
  const client = { sendAgentMessage: vi.fn<SendOutboxFlushClient["sendAgentMessage"]>() };
  const composerOutbox = createDirectSendOutbox("server", client)!;
  return {
    entry,
    client,
    composerOutbox,
    useSessionStore,
    useSendOutboxStore,
    canEditRefusedSend,
    retryDirectSend,
    flushSendOutboxForServer,
    isActive: () =>
      selectAgentTurnPresentation(useSessionStore.getState().sessions.server, "agent").isActive,
  };
}

function refusal(message = "Agent refused this message") {
  return Object.assign(new Error(message), { name: "DaemonRpcError" });
}

describe("send outbox submission settlement", () => {
  it.each(["composer", "reconnect", "retry"])(
    "retires a live submission after transport loss then refusal through %s",
    async (origin) => {
      const state = await setupLiveSend();
      state.client.sendAgentMessage.mockRejectedValueOnce(new Error("Connection lost"));
      await state.composerOutbox.flush("agent");
      expect(state.isActive()).toBe(true);
      expect(state.useSendOutboxStore.getState().entries["msg-1"].attempts).toBe(1);

      state.client.sendAgentMessage.mockRejectedValueOnce(refusal());
      const onRejected = vi.fn(() => expect(state.isActive()).toBe(false));
      if (origin === "composer") await state.composerOutbox.flush("agent");
      else if (origin === "retry")
        await state.retryDirectSend({ entry: state.entry, client: state.client });
      else {
        await state.flushSendOutboxForServer({
          serverId: "server",
          client: state.client,
          onRejected,
        });
        expect(onRejected).toHaveBeenCalledTimes(1);
      }

      expect(state.isActive()).toBe(false);
      const saved = state.useSendOutboxStore.getState().entries["msg-1"];
      expect(saved).toMatchObject({
        text: state.entry.text,
        rejectedError: "Agent refused this message",
      });
      expect(state.canEditRefusedSend(saved)).toBe(true);
      expect(state.useSessionStore.getState().sessions.server.agentStreamTail.get("agent")).toEqual(
        [],
      );
      expect(JSON.parse(storage.values.get("paseo-send-outbox")!).state.entries["msg-1"]).toEqual(
        saved,
      );

      state.client.sendAgentMessage.mockRejectedValueOnce(refusal("Still refused"));
      await state.retryDirectSend({ entry: saved, client: state.client });
      expect(state.useSendOutboxStore.getState().entries["msg-1"].rejectedError).toBe(
        "Still refused",
      );
      expect(state.isActive()).toBe(false);
      state.useSessionStore.getState().clearSession("server");
    },
  );

  it("keeps an uncertain outcome live and uneditable until an identical retry answers definitively", async () => {
    const state = await setupLiveSend();
    state.client.sendAgentMessage.mockRejectedValueOnce(refusal("agent_request_outcome_unknown"));
    await state.flushSendOutboxForServer({ serverId: "server", client: state.client });
    const saved = state.useSendOutboxStore.getState().entries["msg-1"];
    expect(state.isActive()).toBe(true);
    expect(state.canEditRefusedSend(saved)).toBe(false);
    state.client.sendAgentMessage.mockRejectedValueOnce(refusal());
    await state.retryDirectSend({ entry: saved, client: state.client });
    expect(state.client.sendAgentMessage.mock.calls[1]).toEqual(
      state.client.sendAgentMessage.mock.calls[0],
    );
    expect(state.isActive()).toBe(false);
    state.useSessionStore.getState().clearSession("server");
  });

  it("preserves an observed canonical row and a different live submission on refusal", async () => {
    const state = await setupLiveSend();
    const store = state.useSessionStore.getState();
    store.setAgentStreamState("server", "agent", { acknowledgedClientMessageIds: ["msg-1"] });
    store.beginAgentMessageSubmission("server", "agent", {
      kind: "user_message",
      id: "newer",
      clientMessageId: "newer",
      text: "Newer message",
      timestamp: new Date(1),
    });
    state.client.sendAgentMessage.mockRejectedValueOnce(refusal());
    await state.flushSendOutboxForServer({ serverId: "server", client: state.client });
    const session = state.useSessionStore.getState().sessions.server;
    expect(session.messageSubmissions.get("agent")?.map((item) => item.clientMessageId)).toEqual([
      "newer",
    ]);
    expect(session.agentStreamTail.get("agent")?.map((item) => item.id)).toEqual([
      "msg-1",
      "newer",
    ]);
    expect(state.isActive()).toBe(true);
    state.useSessionStore.getState().clearSession("server");
  });
});

async function setupOrderedDelivery() {
  const state = await setupLiveSend();
  const { useQueueOutboxStore, flushQueueOutboxForServer } = await import("@/stores/queue-outbox-store");
  const { queueComposerMessageOnServer } = await import("@/composer/actions");
  const { discardDirectSend } = await import("@/composer/delivery-actions");
  const calls: string[] = [];
  const client = {
    ...state.client,
    getQueuedAgentMessageImages: vi.fn(async () => []),
    enqueueAgentMessage: vi.fn(async (input: { agentId: string; text: string }) => {
      calls.push(input.text);
      return { agentId: input.agentId, revision: 1, items: [] };
    }),
    removeQueuedAgentMessage: vi.fn(async (agentId: string) => ({ agentId, revision: 2, items: [] })),
  };
  state.useSessionStore.getState().updateSessionClient("server", client as unknown as DaemonClient);
  const flushQueue = () => flushQueueOutboxForServer({ serverId: "server", client, applySnapshot: vi.fn() });
  let queueFlush = Promise.resolve();
  const queue = (text = "B", agentId = "agent") => queueComposerMessageOnServer({
    agentId,
    text,
    attachments: [],
    client,
    encodeImages: async () => [],
    queue: { read: () => [], write: vi.fn() },
    applySnapshot: vi.fn(),
    outbox: {
      serverId: "server",
      add: (entry) => useQueueOutboxStore.getState().add({ ...entry, serverId: "server" }),
      remove: (id) => useQueueOutboxStore.getState().removeDurably(id),
      flush: () => { queueFlush = flushQueue(); return queueFlush; },
    },
  });
  return { ...state, client, calls, queue, flushQueue, useQueueOutboxStore, discardDirectSend, queueSettled: () => queueFlush };
}

function held<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((release) => { resolve = release; });
  return { promise, resolve };
}

describe("shared device delivery ordering", () => {
  it("saves Queue B during a held direct send and dispatches A, B, C in order", async () => {
    const state = await setupOrderedDelivery();
    const first = held<{ queued: boolean }>();
    state.client.sendAgentMessage.mockImplementationOnce(async () => {
      state.calls.push("A");
      return first.promise;
    }).mockImplementationOnce(async () => { state.calls.push("C"); return { queued: false }; });
    const sending = state.flushSendOutboxForServer({ serverId: "server", client: state.client });
    await vi.waitFor(() => expect(state.calls).toEqual(["A"]));
    const queued = await state.queue();
    expect(queued.queued).not.toBeNull();
    const id = queued.queued!.id;
    expect(JSON.parse(storage.values.get("paseo-queue-outbox")!).state.entries[id].text).toBe("B");
    await state.useSendOutboxStore.getState().add({ ...state.entry, clientMessageId: "C", text: "C" });
    expect(state.client.enqueueAgentMessage).not.toHaveBeenCalled();
    first.resolve({ queued: false });
    await sending;
    await state.queueSettled();
    expect(state.calls).toEqual(["A", "B", "C"]);
    expect(state.useQueueOutboxStore.getState().entries[id]).toBeUndefined();
  });

  it.each(["transport", "unknown"])("retains Queue B across %s failure and rehydration until retry settles A", async (failure) => {
    const state = await setupOrderedDelivery();
    state.client.sendAgentMessage.mockRejectedValue(failure === "transport" ? new Error("Connection lost") : refusal("agent_request_outcome_unknown"));
    await state.flushSendOutboxForServer({ serverId: "server", client: state.client });
    const result = await state.queue();
    await state.queueSettled();
    expect(state.client.enqueueAgentMessage).not.toHaveBeenCalled();
    const id = result.queued!.id;
    await state.useSendOutboxStore.persist.rehydrate();
    await state.useQueueOutboxStore.persist.rehydrate();
    await state.flushQueue();
    expect(state.client.enqueueAgentMessage).not.toHaveBeenCalled();
    expect(JSON.parse(storage.values.get("paseo-queue-outbox")!).state.entries[id].text).toBe("B");
    const attempts = state.client.sendAgentMessage.mock.calls.length;
    state.client.sendAgentMessage.mockImplementationOnce(async () => { state.calls.push("A settled"); return { queued: false }; });
    await state.retryDirectSend({ entry: state.useSendOutboxStore.getState().entries["msg-1"], client: state.client });
    expect(state.client.sendAgentMessage.mock.calls[attempts]).toEqual(state.client.sendAgentMessage.mock.calls[0]);
    expect(state.calls).toEqual(["A settled", "B"]);
    expect(state.useQueueOutboxStore.getState().entries[id]).toBeUndefined();
  });

  it("keeps an unknown direct-send barrier after a fresh module startup", async () => {
    const state = await setupOrderedDelivery();
    state.client.sendAgentMessage.mockRejectedValue(refusal("agent_request_outcome_unknown"));
    await state.composerOutbox.flush("agent");
    const queued = await state.queue();
    await state.queueSettled();
    const beforeRestart = state.client.sendAgentMessage.mock.calls.length;
    vi.resetModules();
    const restartedQueue = await import("@/stores/queue-outbox-store");
    const restartedSend = await import("./index");
    const { retryDirectSend } = await import("@/composer/delivery-actions");
    await restartedQueue.flushQueueOutboxForServer({ serverId: "server", client: state.client, applySnapshot: vi.fn() });
    expect(state.client.sendAgentMessage).toHaveBeenCalledTimes(beforeRestart);
    expect(state.client.enqueueAgentMessage).not.toHaveBeenCalled();
    expect(restartedQueue.useQueueOutboxStore.getState().entries[queued.queued!.id].text).toBe("B");
    state.client.sendAgentMessage.mockResolvedValueOnce({ queued: false });
    await retryDirectSend({ entry: restartedSend.useSendOutboxStore.getState().entries["msg-1"], client: state.client });
    expect(state.calls).toEqual(["B"]);
    expect(restartedQueue.useQueueOutboxStore.getState().entries[queued.queued!.id]).toBeUndefined();
  });

  it("delivers another agent while the first agent's RPC is held", async () => {
    const state = await setupOrderedDelivery();
    const first = held<{ queued: boolean }>();
    state.client.sendAgentMessage.mockImplementationOnce(async () => {
      state.calls.push("A");
      return first.promise;
    });
    const sending = state.flushSendOutboxForServer({ serverId: "server", client: state.client });
    await vi.waitFor(() => expect(state.calls).toEqual(["A"]));
    await state.queue("independent", "other-agent");
    await vi.waitFor(() => expect(state.calls).toEqual(["A", "independent"]));
    first.resolve({ queued: false });
    await sending;
    await state.queueSettled();
  });

  it("cancels a locally queued follow-up while the direct RPC is still held", async () => {
    const state = await setupOrderedDelivery();
    const first = held<{ queued: boolean }>();
    state.client.sendAgentMessage.mockImplementationOnce(() => first.promise);
    const sending = state.flushSendOutboxForServer({ serverId: "server", client: state.client });
    await vi.waitFor(() => expect(state.client.sendAgentMessage).toHaveBeenCalledOnce());
    const queued = await state.queue();
    const id = queued.queued!.id;
    await state.useQueueOutboxStore.getState().requestRemoval(state.useQueueOutboxStore.getState().entries[id]);
    const removing = state.flushQueue();
    await vi.waitFor(() => expect(state.client.removeQueuedAgentMessage).toHaveBeenCalledWith("agent", id));
    first.resolve({ queued: false });
    await Promise.all([sending, removing, state.queueSettled()]);
    expect(state.client.enqueueAgentMessage).not.toHaveBeenCalled();
    expect(state.useQueueOutboxStore.getState().entries[id]).toBeUndefined();
  });

  it("does not let a held queue RPC block another agent's queue admission", async () => {
    const state = await setupOrderedDelivery();
    await state.useSendOutboxStore.getState().removeDurably("msg-1");
    const first = held<{ agentId: string; revision: number; items: [] }>();
    state.client.enqueueAgentMessage.mockImplementationOnce(async () => {
      state.calls.push("held");
      return first.promise;
    });
    await state.queue("held");
    const sending = state.queueSettled();
    await vi.waitFor(() => expect(state.calls).toEqual(["held"]));
    await state.queue("independent", "other-agent");
    await vi.waitFor(() => expect(state.calls).toEqual(["held", "independent"]));
    first.resolve({ agentId: "agent", revision: 1, items: [] });
    await Promise.all([sending, state.queueSettled()]);
  });

  it.each(["accepted", "refused"])("wakes B after a retry is definitively %s", async (outcome) => {
    const state = await setupOrderedDelivery();
    state.client.sendAgentMessage.mockRejectedValue(refusal("agent_request_outcome_unknown"));
    await state.composerOutbox.flush("agent");
    await state.queue();
    await state.queueSettled();
    if (outcome === "accepted") state.client.sendAgentMessage.mockResolvedValueOnce({ queued: false });
    else state.client.sendAgentMessage.mockRejectedValueOnce(refusal("Agent refused this message"));
    await state.retryDirectSend({ entry: state.useSendOutboxStore.getState().entries["msg-1"], client: state.client });
    expect(state.calls).toEqual(["B"]);
  });

  it("wakes the queue on explicit discard of an unknown send", async () => {
    const state = await setupOrderedDelivery();
    state.client.sendAgentMessage.mockRejectedValue(refusal("agent_request_outcome_unknown"));
    await state.composerOutbox.flush("agent");
    await state.queue();
    await state.queueSettled();
    await state.discardDirectSend(state.useSendOutboxStore.getState().entries["msg-1"]);
    await vi.waitFor(() => expect(state.calls).toEqual(["B"]));
    await state.flushQueue();
  });

  it("allows cancellation and other agents while A remains unknown", async () => {
    const state = await setupOrderedDelivery();
    state.client.sendAgentMessage.mockRejectedValue(refusal("agent_request_outcome_unknown"));
    await state.composerOutbox.flush("agent");
    const result = await state.queue();
    await state.queueSettled();
    const id = result.queued!.id;
    await state.useQueueOutboxStore.getState().requestRemoval(state.useQueueOutboxStore.getState().entries[id]);
    await state.flushQueue();
    expect(state.client.removeQueuedAgentMessage).toHaveBeenCalledWith("agent", id);
    expect(state.useQueueOutboxStore.getState().entries[id]).toBeUndefined();
    await state.queue("independent", "other-agent");
    await state.queueSettled();
    expect(state.calls).toEqual(["independent"]);
    expect(state.useSendOutboxStore.getState().entries["msg-1"].rejectedError).toBe("agent_request_outcome_unknown");
  });
});
