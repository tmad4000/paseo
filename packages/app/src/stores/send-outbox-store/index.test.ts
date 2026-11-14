import { beforeAll, describe, expect, it, vi } from "vitest";
import type { DirectRouteDeliveryInput } from "@/components/sidebar/session-routing/delivery";
import { AgentSnapshotPayloadSchema } from "@getpaseo/protocol/messages";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { SendOutboxFlushClient } from "./model";

const confirmation = vi.hoisted(() => ({ accepted: true }));
vi.mock("@/utils/confirm-dialog", () => ({ confirmDialog: vi.fn(async () => confirmation.accepted) }));

const storage = vi.hoisted(() => ({
  values: new Map<string, string>(),
  readHold: undefined as Promise<void> | undefined,
  reads: new Map<string, Promise<void>>(),
  writes: new Map<string, Promise<void>>(),
  failOnce: undefined as string | undefined,
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => {
      await storage.readHold;
      await storage.reads.get(key);
      return storage.values.get(key) ?? null;
    },
    setItem: async (key: string, value: string) => {
      await storage.writes.get(key);
      if (storage.failOnce === key) { storage.failOnce = undefined; throw new Error("disk full"); }
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
  await import("@/stores/delivery-outboxes");
  await import("@/views/broadcast");
  await import("@/companion-stream/send-reply");
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
  confirmation.accepted = true;
  storage.readHold = undefined;
  storage.reads.clear();
  storage.writes.clear();
  storage.failOnce = undefined;
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

async function prepareRoutedFollowUp(state: Awaited<ReturnType<typeof setupOrderedDelivery>>, itemId: string) {
  const { useDraftStore, awaitDraftHydration, flushDraftPersistStorageDurably } = await import("@/stores/draft-store");
  const { SESSION_ROUTING_DRAFT_KEY } = await import("@/stores/draft-keys");
  const { deliverRoutedPrompt } = await import("@/components/sidebar/session-routing/delivery");
  await awaitDraftHydration();
  useDraftStore.getState().editDraftText({ draftKey: SESSION_ROUTING_DRAFT_KEY, text: "  routed B  " });
  await flushDraftPersistStorageDurably();
  const record = useDraftStore.getState().drafts[SESSION_ROUTING_DRAFT_KEY]!;
  let eligible = true;
  const input = {
    recipient: {
      serverId: "server", agentId: "agent", workspaceId: "workspace", projectId: "project",
      projectViewKey: "project", hostLabel: "Host", projectName: "Project", title: "Chat", excerpt: "", confidence: 1,
    },
    text: "  routed B  ", itemId, draftVersion: record.version, draftUpdatedAt: record.updatedAt,
    client: state.client,
    isHostEligible: () => eligible,
    outbox: state.useQueueOutboxStore.getState(),
    applySnapshot: vi.fn(),
  };
  const sending = deliverRoutedPrompt(input).then((value) => ({ value }), (error: unknown) => ({ error }));
  await vi.waitFor(() => expect(state.useQueueOutboxStore.getState().entries[itemId]).toMatchObject({ routingDispatchHeld: true, text: input.text }));
  return { input, sending, exclude: () => { eligible = false; }, draft: () => useDraftStore.getState().getDraftInput(SESSION_ROUTING_DRAFT_KEY)?.text };
}

describe("all client queue admissions respect unresolved direct sends", () => {
  it("holds routed Queue B with its draft escrow until pre-dispatch A is accepted", async () => {
    const state = await setupOrderedDelivery();
    const first = held<{ queued: boolean }>();
    state.client.sendAgentMessage.mockImplementationOnce(async () => { state.calls.push("A"); return first.promise; });
    const sending = state.flushSendOutboxForServer({ serverId: "server", client: state.client });
    await vi.waitFor(() => expect(state.calls).toEqual(["A"]));
    const routed = await prepareRoutedFollowUp(state, "routed-B");
    expect(routed.draft()).toBe("  routed B  ");
    expect(state.client.enqueueAgentMessage).not.toHaveBeenCalled();
    first.resolve({ queued: false });
    await sending;
    expect(await routed.sending).toEqual({ value: { queued: false } });
    expect(state.calls).toEqual(["A", "  routed B  "]);
    expect(state.client.enqueueAgentMessage).toHaveBeenCalledWith(expect.objectContaining({
      itemId: "routed-B", expectedWorkspaceId: "workspace", expectedProjectId: "project", text: "  routed B  ",
    }));
    expect(routed.draft()).toBe("");
    expect(state.useQueueOutboxStore.getState().entries["routed-B"]).toBeUndefined();
  });

  it.each(["retry", "discard"])("wakes routed Queue B after an unknown A is settled by %s", async (wake) => {
    const state = await setupOrderedDelivery();
    state.client.sendAgentMessage.mockRejectedValue(refusal("agent_request_outcome_unknown"));
    await state.composerOutbox.flush("agent");
    const routed = await prepareRoutedFollowUp(state, "unknown-routed-B");
    await state.flushQueue();
    expect(state.client.enqueueAgentMessage).not.toHaveBeenCalled();
    expect(routed.draft()).toBe("  routed B  ");
    const first = state.useSendOutboxStore.getState().entries["msg-1"];
    if (wake === "discard") await state.discardDirectSend(first);
    else {
      state.client.sendAgentMessage.mockResolvedValueOnce({ queued: false });
      await state.retryDirectSend({ entry: first, client: state.client });
      expect(state.client.sendAgentMessage.mock.calls.at(-1)).toEqual(state.client.sendAgentMessage.mock.calls[0]);
    }
    expect(await routed.sending).toEqual({ value: { queued: false } });
    expect(state.calls).toEqual(["  routed B  "]);
    expect(routed.draft()).toBe("");
  });

  it("revalidates routing host eligibility after waiting behind A", async () => {
    const state = await setupOrderedDelivery();
    const first = held<{ queued: boolean }>();
    state.client.sendAgentMessage.mockImplementationOnce(() => first.promise);
    const sending = state.flushSendOutboxForServer({ serverId: "server", client: state.client });
    await vi.waitFor(() => expect(state.client.sendAgentMessage).toHaveBeenCalledOnce());
    const routed = await prepareRoutedFollowUp(state, "excluded-B");
    routed.exclude();
    first.resolve({ queued: false });
    await sending;
    expect(await routed.sending).toEqual({ error: expect.objectContaining({ message: "The selected host was excluded. Choose a destination again." }) });
    expect(state.client.enqueueAgentMessage).not.toHaveBeenCalled();
    expect(routed.draft()).toBe("  routed B  ");
  });

  it("automatically delivers ordinary Queue C after excluded routed B is removed when unknown A is discarded", async () => {
    const state = await setupOrderedDelivery();
    state.client.sendAgentMessage.mockRejectedValue(refusal("agent_request_outcome_unknown"));
    await state.composerOutbox.flush("agent");
    const routed = await prepareRoutedFollowUp(state, "excluded-routed-B");
    const ordinary = await state.queue("ordinary C");
    const ordinaryId = ordinary.queued!.id;
    await state.queueSettled();
    await state.flushQueue();
    expect(state.client.enqueueAgentMessage).not.toHaveBeenCalled();
    expect(state.useSendOutboxStore.getState().entries["msg-1"].rejectedError).toBe("agent_request_outcome_unknown");
    expect(state.useQueueOutboxStore.getState().entries[ordinaryId].text).toBe("ordinary C");

    routed.exclude();
    await state.discardDirectSend(state.useSendOutboxStore.getState().entries["msg-1"]);

    expect(await routed.sending).toEqual({ error: expect.objectContaining({ message: "The selected host was excluded. Choose a destination again." }) });
    await vi.waitFor(() => expect(state.calls).toEqual(["ordinary C"]));
    await vi.waitFor(() => expect(state.useQueueOutboxStore.getState().entries[ordinaryId]).toBeUndefined());
    expect(state.useQueueOutboxStore.getState().entries["excluded-routed-B"]).toBeUndefined();
    expect(state.useSendOutboxStore.getState().entries["msg-1"]).toBeUndefined();
    expect(state.client.enqueueAgentMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ itemId: ordinaryId, text: "ordinary C" }));
    expect(JSON.parse(storage.values.get("paseo-queue-outbox")!).state.entries).toEqual({});
    expect(routed.draft()).toBe("  routed B  ");
  });

  it.each(["response lost", "agent_request_outcome_unknown"])("retains the routed B barrier after %s while ordinary C waits", async (message) => {
    const state = await setupOrderedDelivery();
    state.client.sendAgentMessage.mockRejectedValue(refusal("agent_request_outcome_unknown"));
    await state.composerOutbox.flush("agent");
    const routed = await prepareRoutedFollowUp(state, "unresolved-routed-B");
    const ordinary = await state.queue("ordinary C");
    const ordinaryId = ordinary.queued!.id;
    await state.queueSettled();
    await state.flushQueue();
    state.client.enqueueAgentMessage.mockRejectedValue(new Error(message));

    await state.discardDirectSend(state.useSendOutboxStore.getState().entries["msg-1"]);

    expect(await routed.sending).toEqual({ error: new Error(message) });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(state.client.enqueueAgentMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ itemId: "unresolved-routed-B", text: "  routed B  " }));
    expect(state.useQueueOutboxStore.getState().entries["unresolved-routed-B"].text).toBe("  routed B  ");
    expect(state.useQueueOutboxStore.getState().entries[ordinaryId].text).toBe("ordinary C");
    const saved = JSON.parse(storage.values.get("paseo-queue-outbox")!).state.entries;
    expect(saved).toEqual({
      "unresolved-routed-B": state.useQueueOutboxStore.getState().entries["unresolved-routed-B"],
      [ordinaryId]: state.useQueueOutboxStore.getState().entries[ordinaryId],
    });
    expect(routed.draft()).toBe("  routed B  ");
  });

  it("cancels routed Queue B behind an unknown A without admitting its payload", async () => {
    const state = await setupOrderedDelivery();
    state.client.sendAgentMessage.mockRejectedValue(refusal("agent_request_outcome_unknown"));
    await state.composerOutbox.flush("agent");
    const routed = await prepareRoutedFollowUp(state, "canceled-routed-B");
    await state.useQueueOutboxStore.getState().requestRemoval(state.useQueueOutboxStore.getState().entries["canceled-routed-B"]);
    await state.flushQueue();
    expect(await routed.sending).toEqual({ error: expect.objectContaining({ message: expect.stringContaining("cancel") }) });
    expect(state.client.enqueueAgentMessage).not.toHaveBeenCalled();
    expect(state.client.removeQueuedAgentMessage).toHaveBeenCalledWith("agent", "canceled-routed-B");
    expect(routed.draft()).toBe("  routed B  ");
  });

  it.each(["held", "unknown"])("saves Send Back behind %s A and delivers after A settles", async (outcome) => {
    const state = await setupOrderedDelivery();
    const { queueThreadAnswer } = await import("@/threads/send-back");
    const first = held<{ queued: boolean }>();
    if (outcome === "held") state.client.sendAgentMessage.mockImplementationOnce(() => first.promise);
    else state.client.sendAgentMessage.mockRejectedValue(refusal("agent_request_outcome_unknown"));
    const sending = state.flushSendOutboxForServer({ serverId: "server", client: state.client });
    await vi.waitFor(() => expect(state.client.sendAgentMessage).toHaveBeenCalledOnce());
    if (outcome === "unknown") await sending;
    const id = await queueThreadAnswer({ serverId: "server", parentAgentId: "agent", threadAgentId: "thread", threadTitle: "Side thread", reply: "Answer B", client: state.client });
    const saved = state.useQueueOutboxStore.getState().entries[id];
    expect(saved.text).toBe('From the side thread "Side thread" (Paseo session thread):\n\n> Answer B');
    expect(JSON.parse(storage.values.get("paseo-queue-outbox")!).state.entries[id]).toEqual(saved);
    expect(state.client.enqueueAgentMessage).not.toHaveBeenCalled();
    if (outcome === "held") { first.resolve({ queued: false }); await sending; }
    else await state.discardDirectSend(state.useSendOutboxStore.getState().entries["msg-1"]);
    await state.flushQueue();
    expect(state.calls).toEqual([saved.text]);
    expect(state.useQueueOutboxStore.getState().entries[id]).toBeUndefined();
  });

  it("queues Send Back on a queue-capable older host without direct-send receipts", async () => {
    const state = await setupOrderedDelivery();
    await state.useSendOutboxStore.getState().removeDurably("msg-1");
    const { queueThreadAnswer } = await import("@/threads/send-back");
    const client = {
      enqueueAgentMessage: state.client.enqueueAgentMessage,
      getLastServerInfoMessage: () => ({ features: { agentMessageQueue: true, agentRequestReceipts: false } }),
    };
    const id = await queueThreadAnswer({ serverId: "server", parentAgentId: "agent", threadAgentId: "thread", threadTitle: "Legacy host thread", reply: "Still queued", client });
    const { flushQueueOutboxForServer } = await import("@/stores/queue-outbox-store");
    await flushQueueOutboxForServer({ serverId: "server", client, applySnapshot: vi.fn() });
    expect(state.client.enqueueAgentMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ itemId: id, agentId: "agent" }));
    expect(state.client.sendAgentMessage).not.toHaveBeenCalled();
    expect(state.useQueueOutboxStore.getState().entries[id]).toBeUndefined();
  });

  it("keeps a direct admission outside the durable composer behind an unknown send", async () => {
    const state = await setupOrderedDelivery();
    state.client.sendAgentMessage.mockRejectedValue(refusal("agent_request_outcome_unknown"));
    await state.composerOutbox.flush("agent");
    const { dispatchComposerAgentMessage } = await import("@/composer/actions");
    const followUp = vi.fn(async () => ({ queued: false }));
    const sending = dispatchComposerAgentMessage({
      serverId: "server", agentId: "agent", text: "Explicit routed steer", attachments: [], activeTurnBehavior: "steer_only",
      client: { sendAgentMessage: followUp, uploadFile: vi.fn() }, encodeImages: async () => [],
      submission: { begin: vi.fn(), accept: vi.fn(), reject: vi.fn((): "rejected" => "rejected") },
    });
    await state.flushQueue();
    expect(followUp).not.toHaveBeenCalled();
    await state.discardDirectSend(state.useSendOutboxStore.getState().entries["msg-1"]);
    await sending;
    expect(followUp).toHaveBeenCalledExactlyOnceWith("agent", "Explicit routed steer", expect.objectContaining({ activeTurnBehavior: "steer_only" }));
  });
});

describe("delivery order across backward-clock restarts", () => {
  it.each(["direct/direct", "direct/queue", "queue/direct", "queue/queue"])("hydrates both stores before allocating %s order", async (scenario) => {
    storage.values.clear();
    storage.readHold = undefined;
    storage.reads.clear();
    vi.resetModules();
    const [older, newer] = scenario.split("/");
    const directEntry = { ...SAVED.state.entries["msg-1"], createdAt: 2000, rejectedError: "agent_request_outcome_unknown" };
    const queueEntry = { serverId: "server", agentId: "agent", itemId: "older-queue", text: "older", createdAt: 2000, attempts: 0, images: [], attachments: [], composerAttachments: [] };
    storage.values.set(older === "direct" ? "paseo-send-outbox" : "paseo-queue-outbox", JSON.stringify({ state: { entries: older === "direct" ? { "msg-1": directEntry } : { "older-queue": queueEntry } }, version: 1 }));
    const reading = held<void>();
    storage.reads.set(older === "direct" ? "paseo-send-outbox" : "paseo-queue-outbox", reading.promise);
    const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
    try {
      const direct = await import("./index");
      const queue = await import("@/stores/queue-outbox-store");
      let saved = false;
      const adding = (newer === "direct"
        ? direct.useSendOutboxStore.getState().add({ ...directEntry, clientMessageId: "new-direct", rejectedError: undefined })
        : queue.useQueueOutboxStore.getState().add({ ...queueEntry, itemId: "new-queue" })
      ).then(() => { saved = true; return undefined; });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(saved).toBe(false);
      reading.resolve(undefined);
      await adding;
      const entry = newer === "direct" ? direct.useSendOutboxStore.getState().entries["new-direct"] : queue.useQueueOutboxStore.getState().entries["new-queue"];
      expect(entry.createdAt).toBeGreaterThan(2000);
      const sendAgentMessage = vi.fn(async () => ({ queued: false }));
      const enqueueAgentMessage = vi.fn(async () => ({ agentId: "agent", revision: 1, items: [] }));
      const { flushDeliveryOutboxes } = await import("@/stores/delivery-outboxes");
      if (older === "direct") {
        await flushDeliveryOutboxes({ serverId: "server", client: { sendAgentMessage, enqueueAgentMessage } });
        expect(sendAgentMessage).not.toHaveBeenCalled();
        expect(enqueueAgentMessage).not.toHaveBeenCalled();
      } else {
        const events: string[] = [];
        enqueueAgentMessage.mockImplementation(async () => { events.push("queue"); return { agentId: "agent", revision: 1, items: [] }; });
        sendAgentMessage.mockImplementation(async () => { events.push("direct"); return { queued: false }; });
        await flushDeliveryOutboxes({ serverId: "server", client: { sendAgentMessage, enqueueAgentMessage } });
        expect(events).toEqual(newer === "direct" ? ["queue", "direct"] : ["queue", "queue"]);
      }
    } finally {
      reading.resolve(undefined);
      storage.reads.clear();
      clock.mockRestore();
    }
  });
});

async function oneShotRouteFixture() {
  const state = await setupOrderedDelivery();
  await state.useSendOutboxStore.getState().removeDurably("msg-1");
  const { deliverDirectRoutedPrompt } = await import("@/components/sidebar/session-routing/delivery");
  const { createMessageSubmissionWriter } = await import("@/composer/submission/writer");
  const agent = AgentSnapshotPayloadSchema.parse({
    id: "agent", provider: "mock", cwd: "/project", workspaceId: "workspace", model: null,
    createdAt: "2026-10-01", updatedAt: "2026-10-01", lastUserMessageAt: null, status: "idle",
    currentModeId: null, availableModes: [], pendingPermissions: [], persistence: null, title: "Chat",
    capabilities: { supportsStreaming: true, supportsSessionPersistence: true, supportsDynamicModes: false,
      supportsMcpServers: true, supportsReasoningStream: true, supportsToolInvocations: true },
  });
  const input: DirectRouteDeliveryInput = {
    recipient: { serverId: "server", agentId: "agent", workspaceId: "workspace", projectId: "project",
      projectViewKey: "project", hostLabel: "Host", projectName: "Project", title: "Chat", excerpt: "", confidence: 1 },
    text: "one-shot routed A", mode: "steer", client: { ...state.client,
      fetchAgent: vi.fn(async () => ({ agent, project: null })), uploadFile: vi.fn() },
    submission: createMessageSubmissionWriter("server"), isHostEligible: () => true,
    isDestinationCurrent: () => true, supportsSteerOnly: () => true,
    getTurn: () => ({ isActive: false, turnId: null }),
  };
  const start = () => deliverDirectRoutedPrompt(input).then((value) => ({ value }), (error: unknown) => ({ error }));
  const saved = () => Object.values(state.useSendOutboxStore.getState().entries).find((entry) => entry.oneShot)!;
  return { ...state, input, start, saved, agent };
}

describe("durable one-shot delivery ownership", () => {
  it("keeps queued B behind a routed request after held host preparation times out, until explicit review releases it", async () => {
    const state = await oneShotRouteFixture();
    let rejectHost!: (error: Error) => void;
    const hostPreparation = new Promise<{ queued: boolean }>((_resolve, reject) => { rejectHost = reject; });
    state.client.sendAgentMessage.mockImplementationOnce(() => hostPreparation);
    const sending = state.start();
    await vi.waitFor(() => expect(state.client.sendAgentMessage).toHaveBeenCalledOnce());
    const id = state.saved().clientMessageId;
    expect(state.client.sendAgentMessage.mock.calls[0][2].messageId).toBe(id);
    const queued = await state.queue("queued B");
    rejectHost(new Error("Request timed out during host receipt preparation"));
    expect(await sending).toEqual({ error: expect.objectContaining({ reason: "uncertain" }) });
    await state.queueSettled();
    expect(state.client.enqueueAgentMessage).not.toHaveBeenCalled();
    expect(JSON.parse(storage.values.get("paseo-send-outbox")!).state.entries[id]).toMatchObject({ oneShot: true, clientMessageId: id });
    await state.flushQueue();
    expect(state.client.sendAgentMessage).toHaveBeenCalledOnce();
    await expect(state.retryDirectSend({ entry: state.saved(), client: state.client })).rejects.toThrow("one-time");
    const { releaseOneShotDelivery } = await import("@/composer/delivery-actions");
    confirmation.accepted = false;
    await releaseOneShotDelivery(state.saved());
    expect(state.useSendOutboxStore.getState().entries[id].oneShot).toBe(true);
    confirmation.accepted = true;
    await releaseOneShotDelivery(state.saved());
    await vi.waitFor(() => expect(state.useQueueOutboxStore.getState().entries[queued.queued!.id]).toBeUndefined());
    expect(state.calls).toEqual(["queued B"]);
    expect(state.client.sendAgentMessage).toHaveBeenCalledOnce();
  });

  it("retains a one-shot barrier across restart and slow hydration without replaying it", async () => {
    const state = await oneShotRouteFixture();
    state.client.sendAgentMessage.mockRejectedValueOnce(new Error("Connection lost after dispatch"));
    const sending = state.start();
    await sending;
    const id = state.saved().clientMessageId;
    const queued = await state.queue("after restart");
    await state.queueSettled();
    vi.resetModules();
    const reading = held<void>();
    storage.reads.set("paseo-send-outbox", reading.promise);
    const queue = await import("@/stores/queue-outbox-store");
    const flushing = queue.flushQueueOutboxForServer({ serverId: "server", client: state.client, applySnapshot: vi.fn() });
    expect(state.client.enqueueAgentMessage).not.toHaveBeenCalled();
    reading.resolve(undefined);
    storage.reads.clear();
    await flushing;
    const direct = await import("./index");
    expect(direct.useSendOutboxStore.getState().entries[id]).toMatchObject({ oneShot: true, clientMessageId: id });
    expect(state.client.sendAgentMessage).toHaveBeenCalledOnce();
    expect(queue.useQueueOutboxStore.getState().entries[queued.queued!.id].text).toBe("after restart");
    const { useSessionStore } = await import("@/stores/session-store");
    useSessionStore.getState().initializeSession("server", state.client as unknown as DaemonClient);
    const { releaseOneShotDelivery } = await import("@/composer/delivery-actions");
    confirmation.accepted = true;
    await releaseOneShotDelivery(direct.useSendOutboxStore.getState().entries[id]);
    await vi.waitFor(() => expect(queue.useQueueOutboxStore.getState().entries[queued.queued!.id]).toBeUndefined());
    expect(state.client.sendAgentMessage).toHaveBeenCalledOnce();
    expect(state.calls).toEqual(["after restart"]);
  });

  it.each([false, true])("waits for durable barrier storage before dispatch (write fails: %s)", async (failWrite) => {
    const state = await oneShotRouteFixture();
    const writing = held<void>();
    storage.writes.set("paseo-send-outbox", writing.promise);
    if (failWrite) storage.failOnce = "paseo-send-outbox";
    state.client.sendAgentMessage.mockResolvedValue({ queued: false });
    const sending = state.start();
    await vi.waitFor(() => expect(state.saved()?.oneShot).toBe(true));
    const queued = await state.queue("after storage");
    await state.queueSettled();
    expect(state.client.sendAgentMessage).not.toHaveBeenCalled();
    expect(state.client.enqueueAgentMessage).not.toHaveBeenCalled();
    writing.resolve(undefined);
    storage.writes.clear();
    const result = await sending;
    if (failWrite) {
      expect(result).toEqual({ error: new Error("disk full") });
      expect(state.client.sendAgentMessage).not.toHaveBeenCalled();
    } else {
      expect(result).toEqual({ value: { queued: false } });
      expect(state.client.sendAgentMessage).toHaveBeenCalledOnce();
    }
    await vi.waitFor(() => expect(state.useQueueOutboxStore.getState().entries[queued.queued!.id]).toBeUndefined());
    expect(state.calls).toEqual(["after storage"]);
  });

  it("releases known destination failure before dispatch and automatically wakes queued B", async () => {
    const state = await oneShotRouteFixture();
    const preflight = held<{ agent: typeof state.agent; project: null }>();
    state.input.client.fetchAgent = () => preflight.promise;
    state.input.isDestinationCurrent = () => false;
    const sending = state.start();
    await vi.waitFor(() => expect(state.saved()?.oneShot).toBe(true));
    const queued = await state.queue("after failed preflight");
    preflight.resolve({ agent: state.agent, project: null });
    expect(await sending).toEqual({ error: expect.objectContaining({ reason: "destination" }) });
    await state.queueSettled();
    expect(state.client.sendAgentMessage).not.toHaveBeenCalled();
    expect(state.calls).toEqual(["after failed preflight"]);
    expect(state.useQueueOutboxStore.getState().entries[queued.queued!.id]).toBeUndefined();
  });

  it("retains ownership when recovery cannot be saved and lets an explicit release retry succeed", async () => {
    const state = await oneShotRouteFixture();
    state.client.sendAgentMessage.mockRejectedValueOnce(new Error("reply lost"));
    await state.start();
    const saved = state.saved();
    const queued = await state.queue("after recovery storage");
    await state.queueSettled();
    const { releaseOneShotDelivery } = await import("@/composer/delivery-actions");
    storage.failOnce = "paseo-send-outbox";
    await expect(releaseOneShotDelivery(saved)).rejects.toThrow("disk full");
    expect(state.useSendOutboxStore.getState().entries[saved.clientMessageId]).toEqual(saved);
    expect(state.client.enqueueAgentMessage).not.toHaveBeenCalled();
    await releaseOneShotDelivery(saved);
    await vi.waitFor(() => expect(state.useQueueOutboxStore.getState().entries[queued.queued!.id]).toBeUndefined());
    expect(state.client.sendAgentMessage).toHaveBeenCalledOnce();
  });

  it("can explicitly release an in-flight hold without waiting forever for its client promise", async () => {
    const state = await oneShotRouteFixture();
    state.client.sendAgentMessage.mockImplementationOnce(() => held<{ queued: boolean }>().promise);
    const sending = state.start();
    await vi.waitFor(() => expect(state.client.sendAgentMessage).toHaveBeenCalledOnce());
    const queued = await state.queue("after live release");
    await state.discardDirectSend(state.saved());
    expect(await sending).toEqual({ error: expect.objectContaining({ message: expect.stringContaining("released") }) });
    await state.queueSettled();
    expect(state.calls).toEqual(["after live release"]);
    expect(state.useQueueOutboxStore.getState().entries[queued.queued!.id]).toBeUndefined();
  });

  it("can cancel a one-shot admission still waiting behind an older unknown request", async () => {
    const state = await oneShotRouteFixture();
    await state.useSendOutboxStore.getState().add(state.entry);
    state.client.sendAgentMessage.mockRejectedValueOnce(refusal("agent_request_outcome_unknown"));
    await state.composerOutbox.flush("agent");
    const sending = state.start();
    await vi.waitFor(() => expect(state.saved()?.oneShot).toBe(true));
    await state.flushQueue();
    await state.discardDirectSend(state.saved());
    expect(await sending).toEqual({ error: expect.objectContaining({ message: expect.stringContaining("released") }) });
    expect(state.client.sendAgentMessage).toHaveBeenCalledOnce();
    expect(state.useSendOutboxStore.getState().entries["msg-1"].rejectedError).toBe("agent_request_outcome_unknown");
  });

  it("provides the client adapter needed to retry older saved work before a routed direct request", async () => {
    const state = await oneShotRouteFixture();
    await state.useSendOutboxStore.getState().add(state.entry);
    const order: string[] = [];
    state.client.sendAgentMessage.mockImplementation(async (_agentId, text) => { order.push(text); return { queued: false }; });
    expect(await state.start()).toEqual({ value: { queued: false } });
    expect(order).toEqual([state.entry.text, state.input.text]);
    expect(state.useSendOutboxStore.getState().entries).toEqual({});
  });

  it("retains ambiguous ownership on legacy hosts without replay and supports explicit recovery", async () => {
    const state = await oneShotRouteFixture();
    state.useSessionStore.getState().updateSessionServerInfo("server", {
      serverId: "server", hostname: null, version: "legacy", features: { agentMessageQueue: true },
    });
    state.input.supportsSteerOnly = () => false;
    state.client.sendAgentMessage.mockRejectedValueOnce(new Error("Legacy response lost"));
    await state.start();
    expect(state.client.sendAgentMessage.mock.calls[0][2].activeTurnBehavior).toBeUndefined();
    await state.queue("legacy queued B");
    await state.queueSettled();
    await state.flushQueue();
    expect(state.client.sendAgentMessage).toHaveBeenCalledOnce();
    expect(state.client.enqueueAgentMessage).not.toHaveBeenCalled();
    await expect(state.retryDirectSend({ entry: state.saved(), client: state.client })).rejects.toThrow("one-time");
    await state.discardDirectSend(state.saved());
    await vi.waitFor(() => expect(state.calls).toEqual(["legacy queued B"]));
    await state.flushQueue();
  });
});

describe("one-shot Stream replies and broadcast receipts", () => {
  it("keeps an ambiguous Stream reply as a durable ordering hold until explicitly released", async () => {
    const state = await oneShotRouteFixture();
    const { sendStreamReply } = await import("@/companion-stream/send-reply");
    state.client.sendAgentMessage.mockRejectedValueOnce(new Error("Stream reply acknowledgement lost"));
    await expect(sendStreamReply({ serverId: "server", agentId: "agent", replyTo: "Question", text: "Answer A", client: state.client })).rejects.toThrow("acknowledgement lost");
    const saved = state.saved();
    expect(saved.text).toBe("> Question\n\nAnswer A");
    expect(state.client.sendAgentMessage.mock.calls[0][2].messageId).toBe(saved.clientMessageId);
    await state.queue("Stream follow-up B");
    await state.queueSettled();
    expect(state.client.enqueueAgentMessage).not.toHaveBeenCalled();
    await state.flushQueue();
    expect(state.client.sendAgentMessage).toHaveBeenCalledOnce();
    await state.discardDirectSend(saved);
    await vi.waitFor(() => expect(state.calls).toEqual(["Stream follow-up B"]));
    await state.flushQueue();
  });

  it.each(["held", "refused"])("reports a device-saved broadcast as pending when delivery is %s", async (outcome) => {
    const state = await oneShotRouteFixture();
    const { runBroadcast } = await import("@/views/broadcast");
    const { getHostRuntimeStore } = await import("@/runtime/host-runtime");
    const runtimeClient = vi.spyOn(getHostRuntimeStore(), "getClient").mockReturnValue(state.client as unknown as DaemonClient);
    const acknowledgement = held<{ queued: boolean }>();
    if (outcome === "held") state.client.sendAgentMessage.mockImplementationOnce(() => acknowledgement.promise);
    else state.client.sendAgentMessage.mockRejectedValueOnce(refusal("Broadcast refused"));
    try {
      const result = await runBroadcast("broadcast payload", [{ serverId: "server", agentId: "agent", delivery: "send" }]);
      expect(result).toEqual({ sent: 0, pending: 1, queued: 0, skipped: 0, failed: 0 });
      await vi.waitFor(() => expect(state.client.sendAgentMessage).toHaveBeenCalledOnce());
      if (outcome === "held") acknowledgement.resolve({ queued: false });
      await state.flushSendOutboxForServer({ serverId: "server", client: state.client });
      if (outcome === "refused") {
        expect(Object.values(state.useSendOutboxStore.getState().entries)).toEqual([expect.objectContaining({ text: "broadcast payload", rejectedError: "Broadcast refused" })]);
      }
      expect(result.sent).toBe(0);
      const { i18n } = await import("@/i18n/i18next");
      expect(i18n.t("views.broadcast.result", { ...result, lng: "en" })).toBe("Broadcast: 0 sent, 0 queued on host, 1 saved on this device pending delivery, 0 skipped, 0 failed.");
    } finally {
      acknowledgement.resolve({ queued: false });
      runtimeClient.mockRestore();
    }
  });

  it("reports queued broadcasts as device-pending without awaiting host admission", async () => {
    const state = await oneShotRouteFixture();
    const { runBroadcast } = await import("@/views/broadcast");
    const { getHostRuntimeStore } = await import("@/runtime/host-runtime");
    const runtimeClient = vi.spyOn(getHostRuntimeStore(), "getClient").mockReturnValue(state.client as unknown as DaemonClient);
    const acknowledgement = held<{ agentId: string; revision: number; items: [] }>();
    state.client.enqueueAgentMessage.mockImplementationOnce(() => acknowledgement.promise);
    try {
      const result = await runBroadcast("queued broadcast", [{ serverId: "server", agentId: "agent", delivery: "queue" }]);
      expect(result).toEqual({ sent: 0, pending: 1, queued: 0, skipped: 0, failed: 0 });
      await vi.waitFor(() => expect(state.client.enqueueAgentMessage).toHaveBeenCalledOnce());
      acknowledgement.resolve({ agentId: "agent", revision: 1, items: [] });
      await state.flushQueue();
      expect(state.useQueueOutboxStore.getState().entries).toEqual({});
    } finally {
      acknowledgement.resolve({ agentId: "agent", revision: 1, items: [] });
      runtimeClient.mockRestore();
    }
  });

  it("reports broadcasts saved behind unresolved A as pending even when no broadcast request reached the host", async () => {
    const state = await setupOrderedDelivery();
    state.client.sendAgentMessage.mockRejectedValue(refusal("agent_request_outcome_unknown"));
    await state.composerOutbox.flush("agent");
    const { runBroadcast } = await import("@/views/broadcast");
    const { getHostRuntimeStore } = await import("@/runtime/host-runtime");
    const runtimeClient = vi.spyOn(getHostRuntimeStore(), "getClient").mockReturnValue(state.client as unknown as DaemonClient);
    try {
      const result = await runBroadcast("broadcast waits", [{ serverId: "server", agentId: "agent", delivery: "send" }]);
      expect(result).toEqual({ sent: 0, pending: 1, queued: 0, skipped: 0, failed: 0 });
      await state.composerOutbox.flush("agent");
      expect(state.client.sendAgentMessage).toHaveBeenCalledOnce();
      expect(Object.values(state.useSendOutboxStore.getState().entries).map((entry) => entry.text)).toEqual([state.entry.text, "broadcast waits"]);
    } finally {
      runtimeClient.mockRestore();
    }
  });

  it.each([false, true])("counts only confirmed legacy broadcasts as sent or host-queued (queued: %s)", async (hostQueued) => {
    const state = await oneShotRouteFixture();
    state.useSessionStore.getState().updateSessionServerInfo("server", { serverId: "server", hostname: null, version: "legacy", features: { agentMessageQueue: true } });
    state.client.sendAgentMessage.mockResolvedValueOnce({ queued: hostQueued });
    const { runBroadcast } = await import("@/views/broadcast");
    const { getHostRuntimeStore } = await import("@/runtime/host-runtime");
    const runtimeClient = vi.spyOn(getHostRuntimeStore(), "getClient").mockReturnValue(state.client as unknown as DaemonClient);
    try {
      expect(await runBroadcast("legacy broadcast", [{ serverId: "server", agentId: "agent", delivery: "send" }])).toEqual({ sent: hostQueued ? 0 : 1, pending: 0, queued: hostQueued ? 1 : 0, skipped: 0, failed: 0 });
      expect(state.useSendOutboxStore.getState().entries).toEqual({});
    } finally {
      runtimeClient.mockRestore();
    }
  });
});
