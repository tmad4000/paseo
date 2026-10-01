import { describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({ values: new Map<string, string>(), hold: undefined as Promise<void> | undefined }));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => storage.values.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      await storage.hold;
      storage.values.set(key, value);
    },
    removeItem: async (key: string) => { storage.values.delete(key); },
  },
}));

describe("durable outbox acceptance", () => {
  it("confirms storage before returning and restores the payload in a fresh store", async () => {
    storage.values.clear();
    const { useQueueOutboxStore } = await import("./index");
    await useQueueOutboxStore.persist.rehydrate();
    let release!: () => void;
    storage.hold = new Promise<void>((resolve) => { release = resolve; });
    let accepted = false;
    const entry = {
      serverId: "server", agentId: "agent", itemId: "stable-id", text: "restart recovery",
      images: [{ data: "aW1hZ2U=", mimeType: "image/png" }], attachments: [], composerAttachments: [],
    };
    const adding = useQueueOutboxStore.getState().add(entry).then(() => { accepted = true; });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(accepted).toBe(false);
    expect(storage.values.has("paseo-queue-outbox")).toBe(false);
    release();
    await adding;
    storage.hold = undefined;
    vi.resetModules();
    const restarted = (await import("./index")).useQueueOutboxStore;
    await restarted.persist.rehydrate();
    expect(restarted.getState().entriesForAgent("server", "agent")).toEqual([
      { ...entry, attempts: 0, createdAt: expect.any(Number) },
    ]);
  });
});
