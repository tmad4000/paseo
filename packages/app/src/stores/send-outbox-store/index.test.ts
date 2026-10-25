import { describe, expect, it, vi } from "vitest";

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
        activeTurnBehavior: "steer_only",
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
