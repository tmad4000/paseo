import { describe, expect, it, vi } from "vitest";
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
  const { flushSendOutboxForServer, useSendOutboxStore, canEditRefusedSend } = await import("./index");
  const { retryDirectSend } = await import("@/composer/delivery-actions");
  const session = useSessionStore.getState();
  session.initializeSession("server", null as unknown as DaemonClient);
  session.updateSessionServerInfo("server", {
    serverId: "server",
    hostname: null,
    version: "1.0.0",
    features: { canonicalSubmittedPrompts: true, agentRequestReceipts: true, agentMessageQueue: true },
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
    entry, client, composerOutbox, useSessionStore, useSendOutboxStore, canEditRefusedSend,
    retryDirectSend, flushSendOutboxForServer,
    isActive: () => selectAgentTurnPresentation(useSessionStore.getState().sessions.server, "agent").isActive,
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
      else if (origin === "retry") await state.retryDirectSend({ entry: state.entry, client: state.client });
      else {
        await state.flushSendOutboxForServer({ serverId: "server", client: state.client, onRejected });
        expect(onRejected).toHaveBeenCalledTimes(1);
      }

      expect(state.isActive()).toBe(false);
      const saved = state.useSendOutboxStore.getState().entries["msg-1"];
      expect(saved).toMatchObject({ text: state.entry.text, rejectedError: "Agent refused this message" });
      expect(state.canEditRefusedSend(saved)).toBe(true);
      expect(state.useSessionStore.getState().sessions.server.agentStreamTail.get("agent")).toEqual([]);
      expect(JSON.parse(storage.values.get("paseo-send-outbox")!).state.entries["msg-1"]).toEqual(saved);

      state.client.sendAgentMessage.mockRejectedValueOnce(refusal("Still refused"));
      await state.retryDirectSend({ entry: saved, client: state.client });
      expect(state.useSendOutboxStore.getState().entries["msg-1"].rejectedError).toBe("Still refused");
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
    expect(state.client.sendAgentMessage.mock.calls[1]).toEqual(state.client.sendAgentMessage.mock.calls[0]);
    expect(state.isActive()).toBe(false);
    state.useSessionStore.getState().clearSession("server");
  });

  it("preserves an observed canonical row and a different live submission on refusal", async () => {
    const state = await setupLiveSend();
    const store = state.useSessionStore.getState();
    store.setAgentStreamState("server", "agent", { acknowledgedClientMessageIds: ["msg-1"] });
    store.beginAgentMessageSubmission("server", "agent", {
      kind: "user_message", id: "newer", clientMessageId: "newer", text: "Newer message", timestamp: new Date(1),
    });
    state.client.sendAgentMessage.mockRejectedValueOnce(refusal());
    await state.flushSendOutboxForServer({ serverId: "server", client: state.client });
    const session = state.useSessionStore.getState().sessions.server;
    expect(session.messageSubmissions.get("agent")?.map((item) => item.clientMessageId)).toEqual(["newer"]);
    expect(session.agentStreamTail.get("agent")?.map((item) => item.id)).toEqual(["msg-1", "newer"]);
    expect(state.isActive()).toBe(true);
    state.useSessionStore.getState().clearSession("server");
  });
});
