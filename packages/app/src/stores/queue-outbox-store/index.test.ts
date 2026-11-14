import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AgentQueueSnapshot } from "@getpaseo/protocol/messages";

const storage = vi.hoisted(() => ({
  values: new Map<string, string>(),
  hold: undefined as Promise<void> | undefined,
  reads: new Map<string, Promise<void>>(),
  failDraftWriteAfter: undefined as number | undefined,
  failWriteKey: undefined as string | undefined,
  failOnceKey: undefined as string | undefined,
  draftHold: undefined as Promise<void> | undefined,
  outboxHold: undefined as Promise<void> | undefined,
  failRemovalItem: undefined as string | undefined,
  failDispatchMarkerItem: undefined as string | undefined,
  failRestoredDraftKey: undefined as string | undefined,
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => {
      const value = storage.values.get(key) ?? null;
      await storage.reads.get(key);
      return value;
    },
    setItem: async (key: string, value: string) => {
      const failOnce = key === storage.failOnceKey;
      if (failOnce) storage.failOnceKey = undefined;
      if (key === "paseo-drafts") {
        await storage.draftHold;
        if (storage.failRestoredDraftKey) {
          const record = JSON.parse(value).state.drafts[storage.failRestoredDraftKey];
          if (record?.input.text === "continue" && !record.routingClear)
            throw new Error("restoration checkpoint failed");
        }
      }
      if (key === "paseo-queue-outbox") {
        await storage.outboxHold;
        if (
          storage.failDispatchMarkerItem &&
          JSON.parse(value).state.entries[storage.failDispatchMarkerItem]?.routingDispatchHeld ===
            false
        ) {
          storage.failDispatchMarkerItem = undefined;
          throw new Error("dispatch marker failed");
        }
        if (storage.failRemovalItem && !JSON.parse(value).state.entries[storage.failRemovalItem])
          throw new Error("removal failed");
      }
      await storage.hold;
      if (failOnce || key === storage.failWriteKey) throw new Error("checkpoint failed");
      if (key === "paseo-drafts" && storage.failDraftWriteAfter !== undefined) {
        if (storage.failDraftWriteAfter-- === 0) {
          storage.failDraftWriteAfter = undefined;
          throw new Error("strict checkpoint failed");
        }
      }
      storage.values.set(key, value);
    },
    removeItem: async (key: string) => {
      storage.values.delete(key);
    },
  },
}));

beforeAll(async () => {
  await import("@/stores/delivery-outboxes");
}, 30_000);

async function resetPersistedModules() {
  const { flushDraftPersistStorageDurably } = await import("@/stores/draft-store");
  await flushDraftPersistStorageDurably().catch(() => {});
  vi.resetModules();
}

describe("durable outbox acceptance", () => {
  it("confirms storage before returning and restores the payload in a fresh store", async () => {
    storage.values.clear();
    const { useQueueOutboxStore } = await import("./index");
    await useQueueOutboxStore.persist.rehydrate();
    let release!: () => void;
    storage.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let accepted = false;
    const entry = {
      serverId: "server",
      agentId: "agent",
      itemId: "stable-id",
      text: "restart recovery",
      images: [{ data: "aW1hZ2U=", mimeType: "image/png" }],
      attachments: [],
      composerAttachments: [],
    };
    const adding = useQueueOutboxStore
      .getState()
      .add(entry)
      .then(() => {
        accepted = true;
        return undefined;
      });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(accepted).toBe(false);
    expect(storage.values.has("paseo-queue-outbox")).toBe(false);
    release();
    await adding;
    storage.hold = undefined;
    await resetPersistedModules();
    const restarted = (await import("./index")).useQueueOutboxStore;
    await restarted.persist.rehydrate();
    expect(restarted.getState().entriesForAgent("server", "agent")).toEqual([
      { ...entry, attempts: 0, createdAt: expect.any(Number) },
    ]);
  }, 15000);
});

it("cannot dispatch an entry while its write is pending or after that write fails", async () => {
  await resetPersistedModules();
  storage.values.clear();
  storage.hold = undefined;
  const { useQueueOutboxStore, flushQueueOutboxForServer } = await import("./index");
  await useQueueOutboxStore.persist.rehydrate();
  let reject!: (error: Error) => void;
  storage.hold = new Promise<void>((_, rejectWrite) => {
    reject = rejectWrite;
  });
  const adding = useQueueOutboxStore.getState().add({
    serverId: "server",
    agentId: "agent",
    itemId: "unsaved",
    text: "draft",
    images: [],
    attachments: [],
    composerAttachments: [],
  });
  const failed = adding.catch((error: Error) => error.message);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  const enqueueAgentMessage = vi.fn(async () => ({ agentId: "agent", revision: 1, items: [] }));
  await flushQueueOutboxForServer({
    serverId: "server",
    client: {
      getLastServerInfoMessage: () => ({
        features: { sessionSearch: true, agentMessageQueue: true },
      }),
      enqueueAgentMessage,
    },
    applySnapshot: () => {},
  });
  expect(enqueueAgentMessage).not.toHaveBeenCalled();
  storage.hold = undefined;
  reject(new Error("storage full"));
  expect(await failed).toBe("storage full");
  await flushQueueOutboxForServer({
    serverId: "server",
    client: {
      getLastServerInfoMessage: () => ({
        features: { sessionSearch: true, agentMessageQueue: true },
      }),
      enqueueAgentMessage,
    },
    applySnapshot: () => {},
  });
  expect(enqueueAgentMessage).not.toHaveBeenCalled();
  expect(useQueueOutboxStore.getState().entriesForAgent("server", "agent")).toEqual([]);
});

it("keeps durable entries for other agents eligible during a pending write", async () => {
  await resetPersistedModules();
  storage.values.clear();
  storage.hold = undefined;
  const { useQueueOutboxStore } = await import("./index");
  await useQueueOutboxStore.persist.rehydrate();
  const store = useQueueOutboxStore.getState();
  await store.add({
    serverId: "server",
    agentId: "agent-b",
    itemId: "durable-b",
    text: "ready",
    images: [],
    attachments: [],
    composerAttachments: [],
  });
  let release!: () => void;
  storage.hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = useQueueOutboxStore.getState().add({
    serverId: "server",
    agentId: "agent-a",
    itemId: "pending-a",
    text: "saving",
    images: [],
    attachments: [],
    composerAttachments: [],
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(
    useQueueOutboxStore
      .getState()
      .entriesForServer("server")
      .map((entry) => entry.itemId),
  ).toEqual(["durable-b"]);
  release();
  await pending;
  storage.hold = undefined;
});

it("late routing acknowledgement cannot clear a new identical draft after ownership changes", async () => {
  storage.hold = undefined;
  const { useQueueOutboxStore } = await import("./index");
  const { useDraftStore } = await import("@/stores/draft-store");
  const { SESSION_ROUTING_DRAFT_KEY } = await import("@/stores/draft-keys");
  await useQueueOutboxStore.persist.rehydrate();
  await useDraftStore.persist.rehydrate();
  const drafts = useDraftStore.getState();
  drafts.editDraftText({ draftKey: SESSION_ROUTING_DRAFT_KEY, text: "continue" });
  const version = useDraftStore.getState().drafts[SESSION_ROUTING_DRAFT_KEY]?.version;
  await useQueueOutboxStore.getState().add({
    serverId: "host",
    agentId: "chat",
    itemId: "old-routing",
    text: "continue",
    images: [],
    attachments: [],
    composerAttachments: [],
    routingOrigin: true,
    routingDraftVersion: version,
    routingDraftUpdatedAt: useDraftStore.getState().drafts[SESSION_ROUTING_DRAFT_KEY]?.updatedAt,
  });
  drafts.editDraftText({ draftKey: SESSION_ROUTING_DRAFT_KEY, text: "" });
  drafts.editDraftText({ draftKey: SESSION_ROUTING_DRAFT_KEY, text: "continue" });
  await useQueueOutboxStore
    .getState()
    .acknowledge("old-routing", { agentId: "chat", revision: 1, items: [] });
  expect(useDraftStore.getState().getDraftInput(SESSION_ROUTING_DRAFT_KEY)?.text).toBe("continue");
  expect(useQueueOutboxStore.getState().acknowledgements["old-routing"]).toEqual({ queued: false });
});

it("cold-start acknowledgement waits for actual outbox and draft reads before removing ownership", async () => {
  await resetPersistedModules();
  storage.values.clear();
  const { useQueueOutboxStore } = await import("./index");
  const { useDraftStore, flushDraftPersistStorageDurably } = await import("@/stores/draft-store");
  const { SESSION_ROUTING_DRAFT_KEY: key } = await import("@/stores/draft-keys");
  await useDraftStore.persist.rehydrate();
  await useQueueOutboxStore.persist.rehydrate();
  useDraftStore.getState().editDraftText({ draftKey: key, text: "continue" });
  await flushDraftPersistStorageDurably();
  const record = useDraftStore.getState().drafts[key];
  await useQueueOutboxStore.getState().add({
    serverId: "host",
    agentId: "chat",
    itemId: "cold-accepted",
    text: "continue",
    routingOrigin: true,
    routingDraftVersion: record?.version,
    routingDraftUpdatedAt: record?.updatedAt,
    images: [],
    attachments: [],
    composerAttachments: [],
  });
  let releaseDraft!: () => void;
  let releaseOutbox!: () => void;
  storage.reads.set(
    "paseo-drafts",
    new Promise((done) => {
      releaseDraft = done;
    }),
  );
  storage.reads.set(
    "paseo-queue-outbox",
    new Promise((done) => {
      releaseOutbox = done;
    }),
  );
  await resetPersistedModules();
  const restarted = (await import("./index")).useQueueOutboxStore;
  let finished = false;
  const accepting = restarted
    .getState()
    .acknowledge("cold-accepted", { agentId: "chat", revision: 1, items: [] })
    .then(() => restarted.getState().removeDurably("cold-accepted"))
    .then(() => {
      finished = true;
      return undefined;
    });
  try {
    await new Promise((done) => setTimeout(done, 0));
    expect(finished).toBe(false);
    expect(
      JSON.parse(storage.values.get("paseo-queue-outbox")!).state.entries["cold-accepted"],
    ).toBeTruthy();
    releaseOutbox();
    await new Promise((done) => setTimeout(done, 20));
    expect(finished).toBe(false);
    expect(restarted.getState().acknowledgements["cold-accepted"]).toBeUndefined();
    releaseDraft();
    await accepting;
    const drafts = (await import("@/stores/draft-store")).useDraftStore;
    expect(drafts.getState().getDraftInput(key)?.text ?? "").toBe("");
    expect(JSON.parse(storage.values.get("paseo-drafts")!).state.drafts[key].input.text).toBe("");
    expect(restarted.getState().entries["cold-accepted"]).toBeUndefined();
    expect(restarted.getState().acknowledgements["cold-accepted"]).toEqual({ queued: false });
  } finally {
    releaseDraft();
    releaseOutbox();
    storage.reads.clear();
  }
});

it("failed routing draft checkpoint retains original ownership through reload and retry", async () => {
  await resetPersistedModules();
  storage.values.clear();
  const { useQueueOutboxStore } = await import("./index");
  const { useDraftStore, flushDraftPersistStorageDurably } = await import("@/stores/draft-store");
  const { SESSION_ROUTING_DRAFT_KEY: key } = await import("@/stores/draft-keys");
  await useDraftStore.persist.rehydrate();
  await useQueueOutboxStore.persist.rehydrate();
  useDraftStore.getState().editDraftText({ draftKey: key, text: "continue" });
  await flushDraftPersistStorageDurably();
  const record = useDraftStore.getState().drafts[key];
  await useQueueOutboxStore.getState().add({
    serverId: "host",
    agentId: "chat",
    itemId: "checkpoint-owned",
    text: "continue",
    routingOrigin: true,
    routingDraftVersion: record?.version,
    routingDraftUpdatedAt: record?.updatedAt,
    images: [],
    attachments: [],
    composerAttachments: [],
  });
  storage.failWriteKey = "paseo-drafts";
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    await expect(
      useQueueOutboxStore
        .getState()
        .acknowledge("checkpoint-owned", { agentId: "chat", revision: 1, items: [] }),
    ).rejects.toThrow("checkpoint failed");
    expect(useQueueOutboxStore.getState().acknowledgements["checkpoint-owned"]).toBeUndefined();
    expect(useQueueOutboxStore.getState().entries["checkpoint-owned"]).toBeTruthy();
    expect(useDraftStore.getState().drafts[key]).toEqual(record);
    await resetPersistedModules();
    const restarted = await import("./index");
    const drafts = (await import("@/stores/draft-store")).useDraftStore;
    await restarted.useQueueOutboxStore.persist.rehydrate();
    await drafts.persist.rehydrate();
    expect(drafts.getState().getDraftInput(key)?.text).toBe("continue");
    expect(
      restarted.useQueueOutboxStore.getState().entries["checkpoint-owned"]?.routingDraftVersion,
    ).toBe(drafts.getState().drafts[key]?.version);
    storage.failWriteKey = undefined;
    const enqueueAgentMessage = vi.fn(async (_entry: { itemId: string; text: string }) => ({
      agentId: "chat",
      revision: 1,
      items: [],
    }));
    await restarted.flushQueueOutboxForServer({
      serverId: "host",
      client: {
        getLastServerInfoMessage: () => ({
          features: { sessionSearch: true, agentMessageQueue: true },
        }),
        enqueueAgentMessage,
      },
      applySnapshot: () => {},
    });
    expect(enqueueAgentMessage).toHaveBeenCalledTimes(1);
    expect(enqueueAgentMessage.mock.calls[0]?.[0]).toMatchObject({
      itemId: "checkpoint-owned",
      text: "continue",
    });
    expect(restarted.useQueueOutboxStore.getState().entries["checkpoint-owned"]).toBeUndefined();
    expect(drafts.getState().getDraftInput(key)?.text ?? "").toBe("");
  } finally {
    storage.failWriteKey = undefined;
    warning.mockRestore();
  }
});

for (const newer of [undefined, "continue", "a different prompt"] as const) {
  it(`recovers an immediately persisted tentative clear without overwriting ${newer ?? "owned retry"}`, async () => {
    await resetPersistedModules();
    storage.values.clear();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { useQueueOutboxStore } = await import("./index");
    const { useDraftStore, flushDraftPersistStorageDurably } = await import("@/stores/draft-store");
    const { SESSION_ROUTING_DRAFT_KEY: key } = await import("@/stores/draft-keys");
    await useDraftStore.persist.rehydrate();
    await useQueueOutboxStore.persist.rehydrate();
    try {
      useDraftStore.getState().editDraftText({ draftKey: key, text: "continue" });
      await flushDraftPersistStorageDurably();
      const record = useDraftStore.getState().drafts[key]!;
      await useQueueOutboxStore.getState().add({
        serverId: "offline-host",
        agentId: "original-chat",
        expectedWorkspaceId: "original-workspace",
        expectedProjectId: "original-project",
        itemId: "temporal-owned",
        text: "continue",
        routingOrigin: true,
        routingDraftVersion: record.version,
        routingDraftUpdatedAt: record.updatedAt,
        images: [],
        attachments: [],
        composerAttachments: [],
      });
      await vi.advanceTimersByTimeAsync(201);
      storage.failDraftWriteAfter = 1;
      await expect(
        useQueueOutboxStore.getState().acknowledge("temporal-owned", {
          agentId: "original-chat",
          revision: 1,
          items: [],
        }),
      ).rejects.toThrow("strict checkpoint failed");
      const persistedClear = JSON.parse(storage.values.get("paseo-drafts")!).state.drafts[key];
      expect(persistedClear.input.text).toBe("");
      expect(persistedClear.version).toBe(record.version + 1);
      expect(useDraftStore.getState().drafts[key]).toEqual(record);
      expect(useQueueOutboxStore.getState().acknowledgements["temporal-owned"]).toBeUndefined();
      let expected = record;
      if (newer !== undefined) {
        useDraftStore
          .getState()
          .saveDraftInput({ draftKey: key, draft: { text: newer, attachments: [] } });
        expected = useDraftStore.getState().drafts[key]!;
        expect(expected.version).toBe(persistedClear.version);
        expect(expected.updatedAt).toBe(persistedClear.updatedAt);
        await flushDraftPersistStorageDurably();
      }
      vi.clearAllTimers();
      vi.resetModules();
      const restarted = await import("./index");
      const drafts = (await import("@/stores/draft-store")).useDraftStore;
      await restarted.useQueueOutboxStore.persist.rehydrate();
      await drafts.persist.rehydrate();
      await restarted.useQueueOutboxStore.getState().recoverRoutingDraft();
      expect(drafts.getState().drafts[key]).toEqual(expected);
      expect(restarted.useQueueOutboxStore.getState().entries["temporal-owned"]).toMatchObject({
        itemId: "temporal-owned",
        routingDraftVersion: record.version,
        routingDraftUpdatedAt: record.updatedAt,
      });
      const enqueueAgentMessage = vi.fn(async () => ({
        agentId: "original-chat",
        revision: 2,
        items: [],
      }));
      await restarted.flushQueueOutboxForServer({
        serverId: "offline-host",
        client: {
          getLastServerInfoMessage: () => ({
            features: { sessionSearch: true, agentMessageQueue: true },
          }),
          enqueueAgentMessage,
        },
        applySnapshot: () => {},
      });
      expect(enqueueAgentMessage).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          itemId: "temporal-owned",
          text: "continue",
          agentId: "original-chat",
          expectedWorkspaceId: "original-workspace",
          expectedProjectId: "original-project",
        }),
      );
      expect(restarted.useQueueOutboxStore.getState().entries["temporal-owned"]).toBeUndefined();
      expect(drafts.getState().getDraftInput(key)?.text ?? "").toBe(newer ?? "");
    } finally {
      storage.failDraftWriteAfter = undefined;
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
}

it("recovery waits for an active acknowledgement and cannot restore its cleared draft", async () => {
  await resetPersistedModules();
  storage.values.clear();
  const { useQueueOutboxStore } = await import("./index");
  const { useDraftStore, flushDraftPersistStorageDurably } = await import("@/stores/draft-store");
  const { SESSION_ROUTING_DRAFT_KEY: key } = await import("@/stores/draft-keys");
  await useDraftStore.persist.rehydrate();
  await useQueueOutboxStore.persist.rehydrate();
  useDraftStore.getState().editDraftText({ draftKey: key, text: "continue" });
  const record = useDraftStore.getState().drafts[key]!;
  await useQueueOutboxStore.getState().add({
    serverId: "host",
    agentId: "chat",
    itemId: "active-ack",
    text: "continue",
    routingOrigin: true,
    routingDraftVersion: record.version,
    routingDraftUpdatedAt: record.updatedAt,
    images: [],
    attachments: [],
    composerAttachments: [],
  });
  let release!: () => void;
  storage.draftHold = new Promise<void>((done) => {
    release = done;
  });
  try {
    const ack = useQueueOutboxStore
      .getState()
      .acknowledge("active-ack", { agentId: "chat", revision: 1, items: [] });
    await vi.waitFor(() =>
      expect(useDraftStore.getState().drafts[key]?.routingClear?.itemId).toBe("active-ack"),
    );
    let recovered = false;
    const recovery = useQueueOutboxStore
      .getState()
      .recoverRoutingDraft()
      .then(() => {
        recovered = true;
        return undefined;
      });
    await new Promise((done) => setTimeout(done, 10));
    expect(recovered).toBe(false);
    release();
    await ack;
    await recovery;
    expect(useDraftStore.getState().getDraftInput(key)?.text).toBe("");
    await useQueueOutboxStore.getState().removeDurably("active-ack");
    storage.draftHold = undefined;
    await flushDraftPersistStorageDurably();
    await resetPersistedModules();
    const restarted = await import("./index");
    const drafts = (await import("@/stores/draft-store")).useDraftStore;
    await drafts.persist.rehydrate();
    await restarted.useQueueOutboxStore.persist.rehydrate();
    await restarted.useQueueOutboxStore.getState().recoverRoutingDraft();
    expect(drafts.getState().getDraftInput(key)?.text).toBe("");
    expect(restarted.useQueueOutboxStore.getState().entries["active-ack"]).toBeUndefined();
  } finally {
    release();
    storage.draftHold = undefined;
  }
});

it("overlapping acknowledgements checkpoint restored ownership before publishing a receipt", async () => {
  await resetPersistedModules();
  storage.values.clear();
  const { useQueueOutboxStore } = await import("./index");
  const { useDraftStore, flushDraftPersistStorageDurably } = await import("@/stores/draft-store");
  const { SESSION_ROUTING_DRAFT_KEY: key } = await import("@/stores/draft-keys");
  await useDraftStore.persist.rehydrate();
  await useQueueOutboxStore.persist.rehydrate();
  useDraftStore.getState().editDraftText({ draftKey: key, text: "continue" });
  const record = useDraftStore.getState().drafts[key];
  await useQueueOutboxStore.getState().add({
    serverId: "host",
    agentId: "chat",
    itemId: "overlap",
    text: "continue",
    routingOrigin: true,
    routingDraftVersion: record?.version,
    routingDraftUpdatedAt: record?.updatedAt,
    images: [],
    attachments: [],
    composerAttachments: [],
  });
  let release!: () => void;
  storage.draftHold = new Promise<void>((done) => {
    release = done;
  });
  storage.failOnceKey = "paseo-drafts";
  const snapshot = { agentId: "chat", revision: 1, items: [] };
  const first = useQueueOutboxStore
    .getState()
    .acknowledge("overlap", snapshot)
    .catch(() => "failed");
  await new Promise((done) => setTimeout(done, 20));
  const second = useQueueOutboxStore
    .getState()
    .acknowledge("overlap", snapshot)
    .then(() => useQueueOutboxStore.getState().removeDurably("overlap"));
  expect(useQueueOutboxStore.getState().acknowledgements.overlap).toBeUndefined();
  release();
  expect(await first).toBe("failed");
  await second;
  storage.draftHold = undefined;
  await flushDraftPersistStorageDurably();
  await resetPersistedModules();
  const restarted = (await import("./index")).useQueueOutboxStore;
  const drafts = (await import("@/stores/draft-store")).useDraftStore;
  await restarted.persist.rehydrate();
  await drafts.persist.rehydrate();
  expect(restarted.getState().entries.overlap).toBeUndefined();
  expect(drafts.getState().getDraftInput(key)?.text ?? "").toBe("");
});

it("sending within the draft throttle checkpoints ownership before dispatch and cold recovery", async () => {
  await resetPersistedModules();
  storage.values.clear();
  const { useQueueOutboxStore } = await import("./index");
  const { useDraftStore, flushDraftPersistStorageDurably } = await import("@/stores/draft-store");
  const { SESSION_ROUTING_DRAFT_KEY: key } = await import("@/stores/draft-keys");
  const { deliverRoutedPrompt } = await import("@/components/sidebar/session-routing/delivery");
  await useDraftStore.persist.rehydrate();
  await useQueueOutboxStore.persist.rehydrate();
  useDraftStore.getState().editDraftText({ draftKey: key, text: "old" });
  await flushDraftPersistStorageDurably();
  useDraftStore.getState().editDraftText({ draftKey: key, text: "new" });
  const record = useDraftStore.getState().drafts[key];
  let release!: () => void;
  storage.draftHold = new Promise<void>((done) => {
    release = done;
  });
  const enqueueAgentMessage = vi.fn(async () => {
    throw new Error("lost response");
  });
  const input = {
    recipient: {
      serverId: "host",
      agentId: "chat",
      workspaceId: "workspace",
      projectId: "project",
      projectViewKey: "view",
      hostLabel: "M5",
      projectName: "Paseo",
      title: "Chat",
      excerpt: "",
      confidence: 1,
    },
    text: "new",
    isHostEligible: () => true,
    itemId: "fast-send",
    draftVersion: record!.version,
    draftUpdatedAt: record!.updatedAt,
    client: {
      getLastServerInfoMessage: () => ({
        features: { sessionSearch: true, agentMessageQueue: true },
      }),
      enqueueAgentMessage,
    },
    outbox: useQueueOutboxStore.getState(),
    applySnapshot: () => {},
  };
  const sending = deliverRoutedPrompt(input).catch((error: Error) => error.message);
  await new Promise((done) => setTimeout(done, 20));
  expect(enqueueAgentMessage).not.toHaveBeenCalled();
  expect(useQueueOutboxStore.getState().entries["fast-send"]).toBeUndefined();
  release();
  expect(await sending).toBe("lost response");
  storage.draftHold = undefined;
  await resetPersistedModules();
  const restarted = (await import("./index")).useQueueOutboxStore;
  const drafts = (await import("@/stores/draft-store")).useDraftStore;
  await restarted.persist.rehydrate();
  await drafts.persist.rehydrate();
  expect(restarted.getState().entries["fast-send"]).toMatchObject({
    routingDraftVersion: drafts.getState().drafts[key]?.version,
    routingDraftUpdatedAt: drafts.getState().drafts[key]?.updatedAt,
    text: "new",
  });
  expect(drafts.getState().getDraftInput(key)?.text).toBe("new");
  await restarted.getState().removeDurably("fast-send");
  storage.failWriteKey = "paseo-drafts";
  await expect(
    deliverRoutedPrompt({ ...input, itemId: "unsaved-send", outbox: restarted.getState() }),
  ).rejects.toThrow("checkpoint failed");
  storage.failWriteKey = undefined;
  expect(enqueueAgentMessage).toHaveBeenCalledTimes(1);
  expect(restarted.getState().entries["unsaved-send"]).toBeUndefined();
  expect(drafts.getState().getDraftInput(key)?.text).toBe("new");
});

async function routingDispatchFixture(itemId: string) {
  await resetPersistedModules();
  storage.values.clear();
  const outbox = await import("./index");
  const { useDraftStore, flushDraftPersistStorageDurably } = await import("@/stores/draft-store");
  const { SESSION_ROUTING_DRAFT_KEY: key } = await import("@/stores/draft-keys");
  const { deliverRoutedPrompt } = await import("@/components/sidebar/session-routing/delivery");
  await useDraftStore.persist.rehydrate();
  await outbox.useQueueOutboxStore.persist.rehydrate();
  useDraftStore.getState().editDraftText({ draftKey: key, text: "continue" });
  await flushDraftPersistStorageDurably();
  const record = useDraftStore.getState().drafts[key]!;
  const enqueueAgentMessage = vi.fn(
    async (_entry: { itemId: string; text: string }): Promise<AgentQueueSnapshot> => ({
      agentId: "chat",
      revision: 1,
      items: [],
    }),
  );
  const input = {
    recipient: {
      serverId: "host",
      agentId: "chat",
      workspaceId: "workspace",
      projectId: "project",
      projectViewKey: "view",
      hostLabel: "M5",
      projectName: "Paseo",
      title: "Chat",
      excerpt: "",
      confidence: 1,
    },
    text: "continue",
    itemId,
    draftVersion: record.version,
    draftUpdatedAt: record.updatedAt,
    client: {
      getLastServerInfoMessage: () => ({
        features: { sessionSearch: true, agentMessageQueue: true },
      }),
      enqueueAgentMessage,
    },
    outbox: outbox.useQueueOutboxStore.getState(),
    isHostEligible: () => true,
    applySnapshot: () => {},
  };
  return { ...outbox, useDraftStore, key, record, input, enqueueAgentMessage, deliverRoutedPrompt };
}

it("reconnect capability is checked after cold outbox hydration and preserves the original routing draft", async () => {
  const fixture = await routingDispatchFixture("rollback-original");
  await fixture.input.outbox.add({
    serverId: "host",
    agentId: "chat",
    itemId: fixture.input.itemId,
    text: fixture.input.text,
    expectedWorkspaceId: "workspace",
    expectedProjectId: "project",
    routingOrigin: true,
    routingDraftVersion: fixture.record.version,
    routingDraftUpdatedAt: fixture.record.updatedAt,
    routingDispatchHeld: false,
    images: [],
    attachments: [],
    composerAttachments: [],
  });
  await resetPersistedModules();
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  storage.reads.set("paseo-queue-outbox", hold);
  const restarted = await import("./index");
  let capable = true;
  const client = {
    ...fixture.input.client,
    getLastServerInfoMessage: () => ({
      features: { agentMessageQueue: true, sessionSearch: capable },
    }),
  };
  const flushing = restarted.flushQueueOutboxForServer({
    serverId: "host",
    client,
    applySnapshot: () => {},
  });
  capable = false;
  release();
  storage.reads.delete("paseo-queue-outbox");
  await flushing;
  expect(fixture.enqueueAgentMessage).not.toHaveBeenCalled();
  expect(restarted.useQueueOutboxStore.getState().entries[fixture.input.itemId]).toMatchObject({
    routingDraftVersion: fixture.record.version,
    routingDraftUpdatedAt: fixture.record.updatedAt,
    text: fixture.input.text,
    expectedWorkspaceId: "workspace",
    expectedProjectId: "project",
    attempts: 0,
  });
  const { useDraftStore } = await import("@/stores/draft-store");
  await useDraftStore.persist.rehydrate();
  expect(useDraftStore.getState().drafts[fixture.key]).toMatchObject({
    version: fixture.record.version,
    updatedAt: fixture.record.updatedAt,
    input: { text: fixture.input.text },
  });
  capable = true;
  await restarted.flushQueueOutboxForServer({ serverId: "host", client, applySnapshot: () => {} });
  expect(fixture.enqueueAgentMessage).toHaveBeenCalledTimes(1);
  expect(fixture.enqueueAgentMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      itemId: fixture.input.itemId,
      expectedWorkspaceId: "workspace",
      expectedProjectId: "project",
      text: fixture.input.text,
    }),
  );
  expect(restarted.useQueueOutboxStore.getState().entries[fixture.input.itemId]).toBeUndefined();
  expect(useDraftStore.getState().getDraftInput(fixture.key)?.text ?? "").toBe("");
});

for (const checkpoint of ["draft", "outbox"] as const) {
  it(`host exclusion while ${checkpoint} storage waits cannot dispatch now or on reconnect`, async () => {
    const fixture = await routingDispatchFixture(`excluded-${checkpoint}`);
    let eligible = true;
    let release!: () => void;
    const hold = new Promise<void>((done) => {
      release = done;
    });
    if (checkpoint === "draft") storage.draftHold = hold;
    else storage.outboxHold = hold;
    const sending = fixture
      .deliverRoutedPrompt({ ...fixture.input, isHostEligible: () => eligible })
      .catch((error: Error) => error.message);
    await new Promise((done) => setTimeout(done, 20));
    expect(fixture.enqueueAgentMessage).not.toHaveBeenCalled();
    expect(fixture.useQueueOutboxStore.getState().entriesForServer("host")).toEqual([]);
    eligible = false;
    release();
    expect(await sending).toContain("excluded");
    storage.draftHold = undefined;
    storage.outboxHold = undefined;
    await fixture.flushQueueOutboxForServer({
      serverId: "host",
      client: fixture.input.client,
      applySnapshot: () => {},
    });
    expect(fixture.enqueueAgentMessage).not.toHaveBeenCalled();
    expect(fixture.useQueueOutboxStore.getState().entries[fixture.input.itemId]).toBeUndefined();
    expect(fixture.useDraftStore.getState().drafts[fixture.key]).toEqual(fixture.record);
    await resetPersistedModules();
    const restarted = await import("./index");
    await restarted.useQueueOutboxStore.persist.rehydrate();
    await restarted.flushQueueOutboxForServer({
      serverId: "host",
      client: fixture.input.client,
      applySnapshot: () => {},
    });
    expect(fixture.enqueueAgentMessage).not.toHaveBeenCalled();
  });
}

it("failed durable release of an excluded fresh item stays held through reload", async () => {
  const fixture = await routingDispatchFixture("excluded-removal");
  let eligible = true;
  let release!: () => void;
  storage.outboxHold = new Promise<void>((done) => {
    release = done;
  });
  const sending = fixture
    .deliverRoutedPrompt({ ...fixture.input, isHostEligible: () => eligible })
    .catch((error: Error) => error.message);
  await new Promise((done) => setTimeout(done, 20));
  eligible = false;
  storage.failRemovalItem = fixture.input.itemId;
  release();
  expect(await sending).toBe("removal failed");
  storage.outboxHold = undefined;
  storage.failRemovalItem = undefined;
  expect(
    fixture.useQueueOutboxStore.getState().entries[fixture.input.itemId]?.routingDispatchHeld,
  ).toBe(true);
  await resetPersistedModules();
  const restarted = await import("./index");
  const drafts = (await import("@/stores/draft-store")).useDraftStore;
  await restarted.useQueueOutboxStore.persist.rehydrate();
  await drafts.persist.rehydrate();
  await restarted.flushQueueOutboxForServer({
    serverId: "host",
    client: fixture.input.client,
    applySnapshot: () => {},
  });
  expect(fixture.enqueueAgentMessage).not.toHaveBeenCalled();
  expect(
    restarted.useQueueOutboxStore.getState().entries[fixture.input.itemId]?.routingDispatchHeld,
  ).toBe(true);
  expect(drafts.getState().drafts[fixture.key]).toEqual(fixture.record);
  await restarted.useQueueOutboxStore.getState().removeDurably(fixture.input.itemId);
});

for (const rejection of ["direct", "reconnect"] as const) {
  it(`${rejection} rejection publishes no release when durable removal fails`, async () => {
    const fixture = await routingDispatchFixture(`failed-${rejection}`);
    const { AgentQueueDestinationChangedError } =
      await import("@getpaseo/client/internal/daemon-client");
    if (rejection === "reconnect") {
      fixture.enqueueAgentMessage.mockRejectedValueOnce(new Error("response lost"));
      await expect(fixture.deliverRoutedPrompt(fixture.input)).rejects.toThrow("response lost");
    }
    fixture.enqueueAgentMessage.mockRejectedValue(new AgentQueueDestinationChangedError());
    storage.failRemovalItem = fixture.input.itemId;
    try {
      if (rejection === "direct")
        await expect(fixture.deliverRoutedPrompt(fixture.input)).rejects.toThrow("removal failed");
      else
        await expect(
          fixture.flushQueueOutboxForServer({
            serverId: "host",
            client: fixture.input.client,
            applySnapshot: () => {},
          }),
        ).rejects.toThrow("removal failed");
      expect(fixture.useQueueOutboxStore.getState().entries[fixture.input.itemId]).toBeTruthy();
      expect(
        fixture.useQueueOutboxStore.getState().rejections[fixture.input.itemId],
      ).toBeUndefined();
      expect(fixture.useDraftStore.getState().drafts[fixture.key]).toEqual(fixture.record);
      await resetPersistedModules();
      const restarted = await import("./index");
      const drafts = (await import("@/stores/draft-store")).useDraftStore;
      await restarted.useQueueOutboxStore.persist.rehydrate();
      await drafts.persist.rehydrate();
      expect(restarted.useQueueOutboxStore.getState().entries[fixture.input.itemId]).toMatchObject({
        itemId: fixture.input.itemId,
        routingDraftVersion: fixture.record.version,
        routingDraftUpdatedAt: fixture.record.updatedAt,
      });
      expect(drafts.getState().drafts[fixture.key]).toEqual(fixture.record);
      storage.failRemovalItem = undefined;
      const restartedClient = await import("@getpaseo/client/internal/daemon-client");
      fixture.enqueueAgentMessage.mockRejectedValue(
        new restartedClient.AgentQueueDestinationChangedError(),
      );
      await restarted.flushQueueOutboxForServer({
        serverId: "host",
        client: fixture.input.client,
        applySnapshot: () => {},
      });
      expect(
        restarted.useQueueOutboxStore.getState().entries[fixture.input.itemId],
      ).toBeUndefined();
      expect(
        restarted.useQueueOutboxStore.getState().rejections[fixture.input.itemId],
      ).toBeTruthy();
    } finally {
      storage.failRemovalItem = undefined;
    }
  });
}

it("a successful RPC acknowledgement survives failed dispatch-marker persistence without a pushed snapshot", async () => {
  const fixture = await routingDispatchFixture("ack-with-failed-marker");
  storage.failDispatchMarkerItem = fixture.input.itemId;
  expect(await fixture.deliverRoutedPrompt(fixture.input)).toEqual({ queued: false });
  expect(fixture.enqueueAgentMessage).toHaveBeenCalledTimes(1);
  expect(fixture.useQueueOutboxStore.getState().acknowledgements[fixture.input.itemId]).toEqual({
    queued: false,
  });
  expect(fixture.useQueueOutboxStore.getState().entries[fixture.input.itemId]).toBeUndefined();
  await resetPersistedModules();
  const restarted = await import("./index");
  const drafts = (await import("@/stores/draft-store")).useDraftStore;
  await restarted.useQueueOutboxStore.persist.rehydrate();
  await drafts.persist.rehydrate();
  expect(drafts.getState().getDraftInput(fixture.key)?.text ?? "").toBe("");
  await restarted.flushQueueOutboxForServer({
    serverId: "host",
    client: fixture.input.client,
    applySnapshot: () => {},
  });
  expect(fixture.enqueueAgentMessage).toHaveBeenCalledTimes(1);
});

it("an uncertain RPC with failed marker recovers through explicit same-ID retry without unholding unsent items", async () => {
  const fixture = await routingDispatchFixture("unknown-with-failed-marker");
  storage.failDispatchMarkerItem = fixture.input.itemId;
  fixture.enqueueAgentMessage.mockRejectedValueOnce(new Error("response lost"));
  await expect(fixture.deliverRoutedPrompt(fixture.input)).rejects.toThrow("response lost");
  expect(
    fixture.useQueueOutboxStore.getState().entries[fixture.input.itemId]?.routingDispatchHeld,
  ).toBe(true);
  await resetPersistedModules();
  const restarted = await import("./index");
  const drafts = (await import("@/stores/draft-store")).useDraftStore;
  await restarted.useQueueOutboxStore.persist.rehydrate();
  await drafts.persist.rehydrate();
  expect(drafts.getState().drafts[fixture.key]).toEqual(fixture.record);
  await restarted.flushQueueOutboxForServer({
    serverId: "host",
    client: fixture.input.client,
    applySnapshot: () => {},
  });
  expect(fixture.enqueueAgentMessage).toHaveBeenCalledTimes(1);
  const { deliverRoutedPrompt } = await import("@/components/sidebar/session-routing/delivery");
  expect(
    await deliverRoutedPrompt({
      ...fixture.input,
      outbox: restarted.useQueueOutboxStore.getState(),
    }),
  ).toEqual({ queued: false });
  expect(fixture.enqueueAgentMessage).toHaveBeenCalledTimes(2);
  expect(fixture.enqueueAgentMessage.mock.calls.map(([entry]) => entry)).toEqual([
    expect.objectContaining({
      itemId: fixture.input.itemId,
      text: "continue",
      expectedWorkspaceId: "workspace",
      expectedProjectId: "project",
    }),
    expect.objectContaining({
      itemId: fixture.input.itemId,
      text: "continue",
      expectedWorkspaceId: "workspace",
      expectedProjectId: "project",
    }),
  ]);
  expect(restarted.useQueueOutboxStore.getState().entries[fixture.input.itemId]).toBeUndefined();
});

it("held routing cancellation survives cold reload and completes on a legacy host without resend", async () => {
  const fixture = await routingDispatchFixture("cancel-held");
  storage.failDispatchMarkerItem = fixture.input.itemId;
  fixture.enqueueAgentMessage.mockRejectedValueOnce(new Error("response lost"));
  await expect(fixture.deliverRoutedPrompt(fixture.input)).rejects.toThrow("response lost");
  await resetPersistedModules();
  const restarted = await import("./index");
  await restarted.useQueueOutboxStore.persist.rehydrate();
  let store = restarted.useQueueOutboxStore.getState();
  let entry = store.entries[fixture.input.itemId]!;
  expect(entry.routingDispatchHeld).toBe(true);
  storage.failOnceKey = "paseo-queue-outbox";
  await expect(store.requestRemoval(entry)).rejects.toThrow("checkpoint failed");
  expect(
    restarted.useQueueOutboxStore.getState().entries[fixture.input.itemId]?.removalRequested,
  ).toBeUndefined();
  await restarted.useQueueOutboxStore.persist.rehydrate();
  store = restarted.useQueueOutboxStore.getState();
  entry = store.entries[fixture.input.itemId]!;
  expect(entry.routingDispatchHeld).toBe(true);
  let release!: () => void;
  storage.outboxHold = new Promise<void>((done) => {
    release = done;
  });
  const removing = store.requestRemoval(entry);
  await new Promise((done) => setTimeout(done, 20));
  expect(store.entriesForServer("host")).toEqual([]);
  release();
  await removing;
  storage.outboxHold = undefined;
  const removeQueuedAgentMessage = vi.fn(async () => ({ agentId: "chat", revision: 2, items: [] }));
  await restarted.flushQueueOutboxForServer({
    serverId: "host",
    client: { enqueueAgentMessage: fixture.enqueueAgentMessage, removeQueuedAgentMessage },
    applySnapshot: () => {},
  });
  expect(removeQueuedAgentMessage).toHaveBeenCalledWith("chat", fixture.input.itemId);
  expect(fixture.enqueueAgentMessage).toHaveBeenCalledTimes(1);
  expect(restarted.useQueueOutboxStore.getState().entries[fixture.input.itemId]).toBeUndefined();
  expect(restarted.useQueueOutboxStore.getState().rejections[fixture.input.itemId]).toContain(
    "removed from the queue",
  );
});

it("a stale routing retry cannot recreate a durably canceled item with no host receipt", async () => {
  const fixture = await routingDispatchFixture("cancel-retry");
  fixture.enqueueAgentMessage.mockRejectedValueOnce(new Error("response lost"));
  await expect(fixture.deliverRoutedPrompt(fixture.input)).rejects.toThrow("response lost");
  const store = fixture.useQueueOutboxStore.getState();
  await store.requestRemoval(store.entries[fixture.input.itemId]!);
  await fixture.flushQueueOutboxForServer({
    serverId: "host",
    client: {
      enqueueAgentMessage: fixture.enqueueAgentMessage,
      removeQueuedAgentMessage: async () => ({ agentId: "chat", revision: 2, items: [] }),
    },
    applySnapshot: () => {},
  });
  await expect(
    fixture.deliverRoutedPrompt({ ...fixture.input, requireExisting: true }),
  ).rejects.toThrow();
  expect(fixture.enqueueAgentMessage).toHaveBeenCalledTimes(1);
  expect(fixture.useQueueOutboxStore.getState().entries[fixture.input.itemId]).toBeUndefined();
  expect(
    fixture.useQueueOutboxStore.getState().acknowledgements[fixture.input.itemId],
  ).toBeUndefined();
});

for (const newer of ["original", "identical", "different"] as const) {
  it(`cancellation owns a delayed enqueue acknowledgement and preserves ${newer} draft`, async () => {
    const fixture = await routingDispatchFixture(`cancel-race-${newer}`);
    let release!: () => void;
    const waiting = new Promise<void>((done) => {
      release = done;
    });
    fixture.enqueueAgentMessage.mockImplementationOnce(async () => {
      await waiting;
      return { agentId: "chat", revision: 1, items: [] };
    });
    const sending = fixture
      .deliverRoutedPrompt(fixture.input)
      .catch((error: Error) => error.message);
    await vi.waitFor(() => expect(fixture.enqueueAgentMessage).toHaveBeenCalledTimes(1));
    const store = fixture.useQueueOutboxStore.getState();
    await store.requestRemoval(store.entries[fixture.input.itemId]!);
    if (newer !== "original") {
      fixture.useDraftStore.getState().editDraftText({ draftKey: fixture.key, text: "temporary" });
      fixture.useDraftStore.getState().editDraftText({
        draftKey: fixture.key,
        text: newer === "identical" ? "continue" : "another prompt",
      });
    }
    const record = fixture.useDraftStore.getState().drafts[fixture.key];
    release();
    expect(await sending).toContain("cancel");
    expect(
      fixture.useQueueOutboxStore.getState().acknowledgements[fixture.input.itemId],
    ).toBeUndefined();
    expect(
      fixture.useQueueOutboxStore.getState().entries[fixture.input.itemId]?.removalRequested,
    ).toBe(true);
    expect(fixture.useDraftStore.getState().drafts[fixture.key]).toEqual(record);
    storage.failRemovalItem = fixture.input.itemId;
    const removeQueuedAgentMessage = vi.fn(async () => ({
      agentId: "chat",
      revision: 2,
      items: [],
    }));
    await fixture.flushQueueOutboxForServer({
      serverId: "host",
      client: { enqueueAgentMessage: fixture.enqueueAgentMessage, removeQueuedAgentMessage },
      applySnapshot: () => {},
    });
    expect(
      fixture.useQueueOutboxStore.getState().entries[fixture.input.itemId]?.removalRequested,
    ).toBe(true);
    expect(fixture.useQueueOutboxStore.getState().rejections[fixture.input.itemId]).toBeUndefined();
    expect(fixture.useDraftStore.getState().drafts[fixture.key]).toEqual(record);
    storage.failRemovalItem = undefined;
    await fixture.flushQueueOutboxForServer({
      serverId: "host",
      client: { enqueueAgentMessage: fixture.enqueueAgentMessage, removeQueuedAgentMessage },
      applySnapshot: () => {},
    });
    expect(fixture.useQueueOutboxStore.getState().rejections[fixture.input.itemId]).toContain(
      "removed from the queue",
    );
    await store.acknowledge(fixture.input.itemId, { agentId: "chat", revision: 3, items: [] });
    expect(
      fixture.useQueueOutboxStore.getState().acknowledgements[fixture.input.itemId],
    ).toBeUndefined();
    expect(fixture.useDraftStore.getState().drafts[fixture.key]).toEqual(record);
  });
}

it("retry waiting at the serialized dispatch boundary cannot enqueue a cancellation intent", async () => {
  const fixture = await routingDispatchFixture("cancel-at-boundary");
  fixture.enqueueAgentMessage.mockRejectedValueOnce(new Error("response lost"));
  await expect(fixture.deliverRoutedPrompt(fixture.input)).rejects.toThrow("response lost");
  const { serializeQueueOperation } = await import("./model");
  let release!: () => void;
  const blocker = serializeQueueOperation(
    JSON.stringify(["dispatch", "host", "chat"]),
    () =>
      new Promise<void>((done) => {
        release = done;
      }),
  );
  await new Promise((done) => setTimeout(done, 0));
  const retry = fixture
    .deliverRoutedPrompt({ ...fixture.input, requireExisting: true })
    .catch((error: Error) => error.message);
  const store = fixture.useQueueOutboxStore.getState();
  await store.requestRemoval(store.entries[fixture.input.itemId]!);
  release();
  await blocker;
  expect(await retry).toContain("cancel");
  expect(fixture.enqueueAgentMessage).toHaveBeenCalledTimes(1);
  expect(
    fixture.useQueueOutboxStore.getState().entries[fixture.input.itemId]?.removalRequested,
  ).toBe(true);
  expect(fixture.useDraftStore.getState().drafts[fixture.key]).toEqual(fixture.record);
});

it("cold cancellation recovers tentative draft ownership until removal is durable", async () => {
  const fixture = await routingDispatchFixture("cancel-tentative-clear");
  fixture.enqueueAgentMessage.mockRejectedValueOnce(new Error("response lost"));
  await expect(fixture.deliverRoutedPrompt(fixture.input)).rejects.toThrow("response lost");
  const store = fixture.useQueueOutboxStore.getState();
  await store.requestRemoval(store.entries[fixture.input.itemId]!);
  const { editDraftRecordText } = await import("@/stores/draft-store/state");
  const { flushDraftPersistStorageDurably } = await import("@/stores/draft-store");
  const cleared = editDraftRecordText(fixture.record, "", fixture.record.updatedAt + 1, true);
  fixture.useDraftStore.setState({
    drafts: {
      [fixture.key]: {
        ...cleared,
        routingClear: {
          itemId: fixture.input.itemId,
          version: cleared.version,
          updatedAt: cleared.updatedAt,
        },
      },
    },
  });
  await flushDraftPersistStorageDurably();
  await resetPersistedModules();
  const restarted = await import("./index");
  const { useDraftStore } = await import("@/stores/draft-store");
  await restarted.useQueueOutboxStore.persist.rehydrate();
  await useDraftStore.persist.rehydrate();
  await restarted.useQueueOutboxStore.getState().recoverRoutingDraft();
  expect(useDraftStore.getState().drafts[fixture.key]).toMatchObject({
    input: { text: fixture.input.text },
    version: fixture.record.version,
    updatedAt: fixture.record.updatedAt,
  });
  expect(
    restarted.useQueueOutboxStore.getState().entries[fixture.input.itemId]?.removalRequested,
  ).toBe(true);
});

it("cancellation during an acknowledgement checkpoint suppresses success and restores the durable original before removal", async () => {
  const fixture = await routingDispatchFixture("cancel-during-ack");
  fixture.enqueueAgentMessage.mockRejectedValueOnce(new Error("response lost"));
  await expect(fixture.deliverRoutedPrompt(fixture.input)).rejects.toThrow("response lost");
  const store = fixture.useQueueOutboxStore.getState();
  const entry = store.entries[fixture.input.itemId]!;
  let release!: () => void;
  storage.draftHold = new Promise<void>((done) => {
    release = done;
  });
  const acknowledging = store.acknowledge(entry.itemId, {
    agentId: "chat",
    revision: 2,
    items: [],
  });
  await vi.waitFor(() =>
    expect(fixture.useDraftStore.getState().drafts[fixture.key]?.routingClear?.itemId).toBe(
      entry.itemId,
    ),
  );
  const successes: unknown[] = [];
  const unsubscribe = fixture.useQueueOutboxStore.subscribe((state) => {
    if (state.acknowledgements[entry.itemId]) successes.push(state.acknowledgements[entry.itemId]);
  });
  const removing = store.requestRemoval(entry);
  release();
  try {
    await acknowledging;
    await removing;
    storage.draftHold = undefined;
    const removeQueuedAgentMessage = vi.fn(async (_agentId: string, itemId: string) => {
      expect(itemId).toBe(entry.itemId);
      const persisted = JSON.parse(storage.values.get("paseo-drafts")!).state.drafts[fixture.key];
      expect(persisted).toMatchObject({
        input: { text: entry.text },
        version: fixture.record.version,
        updatedAt: fixture.record.updatedAt,
      });
      return { agentId: "chat", revision: 3, items: [] };
    });
    await fixture.flushQueueOutboxForServer({
      serverId: "host",
      client: { enqueueAgentMessage: fixture.enqueueAgentMessage, removeQueuedAgentMessage },
      applySnapshot: () => {},
    });
    expect(successes).toEqual([]);
    expect(removeQueuedAgentMessage).toHaveBeenCalledTimes(1);
    expect(fixture.useQueueOutboxStore.getState().entries[entry.itemId]).toBeUndefined();
    expect(fixture.useDraftStore.getState().drafts[fixture.key]).toMatchObject({
      input: { text: entry.text },
      version: fixture.record.version,
      updatedAt: fixture.record.updatedAt,
    });
    await expect(
      fixture.deliverRoutedPrompt({ ...fixture.input, requireExisting: true }),
    ).rejects.toThrow();
    expect(fixture.enqueueAgentMessage).toHaveBeenCalledTimes(1);
  } finally {
    release();
    storage.draftHold = undefined;
    unsubscribe();
  }
});

it("failed cancellation restoration retains cold ownership until a strict restoration checkpoint succeeds", async () => {
  const fixture = await routingDispatchFixture("cancel-restore-failure");
  fixture.enqueueAgentMessage.mockRejectedValueOnce(new Error("response lost"));
  await expect(fixture.deliverRoutedPrompt(fixture.input)).rejects.toThrow("response lost");
  const store = fixture.useQueueOutboxStore.getState();
  const entry = store.entries[fixture.input.itemId]!;
  let release!: () => void;
  storage.draftHold = new Promise<void>((done) => {
    release = done;
  });
  const acknowledging = store
    .acknowledge(entry.itemId, { agentId: "chat", revision: 2, items: [] })
    .catch((error: Error) => error.message);
  await vi.waitFor(() =>
    expect(fixture.useDraftStore.getState().drafts[fixture.key]?.routingClear?.itemId).toBe(
      entry.itemId,
    ),
  );
  storage.failRestoredDraftKey = fixture.key;
  const removing = store.requestRemoval(entry);
  release();
  try {
    expect(await acknowledging).toBe("restoration checkpoint failed");
    await removing;
    storage.draftHold = undefined;
    const client = {
      enqueueAgentMessage: fixture.enqueueAgentMessage,
      removeQueuedAgentMessage: vi.fn(async () => ({ agentId: "chat", revision: 3, items: [] })),
    };
    await fixture.flushQueueOutboxForServer({ serverId: "host", client, applySnapshot: () => {} });
    expect(fixture.useQueueOutboxStore.getState().entries[entry.itemId]?.removalRequested).toBe(
      true,
    );
    expect(fixture.useQueueOutboxStore.getState().acknowledgements[entry.itemId]).toBeUndefined();
    expect(fixture.useQueueOutboxStore.getState().rejections[entry.itemId]).toBeUndefined();
    await resetPersistedModules();
    const restarted = await import("./index");
    const drafts = (await import("@/stores/draft-store")).useDraftStore;
    await restarted.useQueueOutboxStore.persist.rehydrate();
    await drafts.persist.rehydrate();
    expect(drafts.getState().drafts[fixture.key]?.routingClear?.itemId).toBe(entry.itemId);
    expect(restarted.useQueueOutboxStore.getState().entries[entry.itemId]).toMatchObject({
      removalRequested: true,
      routingDraftVersion: fixture.record.version,
      routingDraftUpdatedAt: fixture.record.updatedAt,
    });
    await restarted.flushQueueOutboxForServer({
      serverId: "host",
      client,
      applySnapshot: () => {},
    });
    expect(restarted.useQueueOutboxStore.getState().entries[entry.itemId]?.removalRequested).toBe(
      true,
    );
    expect(restarted.useQueueOutboxStore.getState().rejections[entry.itemId]).toBeUndefined();
    storage.failRestoredDraftKey = undefined;
    await restarted.flushQueueOutboxForServer({
      serverId: "host",
      client,
      applySnapshot: () => {},
    });
    expect(restarted.useQueueOutboxStore.getState().entries[entry.itemId]).toBeUndefined();
    expect(JSON.parse(storage.values.get("paseo-drafts")!).state.drafts[fixture.key]).toMatchObject(
      {
        input: { text: entry.text },
        version: fixture.record.version,
        updatedAt: fixture.record.updatedAt,
      },
    );
    expect(fixture.enqueueAgentMessage).toHaveBeenCalledTimes(1);
  } finally {
    release();
    storage.draftHold = undefined;
    storage.failRestoredDraftKey = undefined;
  }
});

for (const newer of ["identical", "different"] as const) {
  it(`cancellation during acknowledgement preserves a newer ${newer} draft through removal failure and cold reload`, async () => {
    const fixture = await routingDispatchFixture(`cancel-checkpoint-${newer}`);
    fixture.enqueueAgentMessage.mockRejectedValueOnce(new Error("response lost"));
    await expect(fixture.deliverRoutedPrompt(fixture.input)).rejects.toThrow("response lost");
    const store = fixture.useQueueOutboxStore.getState();
    const entry = store.entries[fixture.input.itemId]!;
    let release!: () => void;
    storage.draftHold = new Promise<void>((done) => {
      release = done;
    });
    const acknowledging = store.acknowledge(entry.itemId, {
      agentId: "chat",
      revision: 2,
      items: [],
    });
    await vi.waitFor(() =>
      expect(fixture.useDraftStore.getState().drafts[fixture.key]?.routingClear?.itemId).toBe(
        entry.itemId,
      ),
    );
    fixture.useDraftStore.getState().editDraftText({
      draftKey: fixture.key,
      text: newer === "identical" ? entry.text : "another prompt",
    });
    const newerRecord = fixture.useDraftStore.getState().drafts[fixture.key]!;
    expect(newerRecord.version).not.toBe(fixture.record.version);
    const removing = store.requestRemoval(entry);
    release();
    try {
      expect(await acknowledging).toBe(false);
      await removing;
      storage.draftHold = undefined;
      storage.failRemovalItem = entry.itemId;
      const client = {
        enqueueAgentMessage: fixture.enqueueAgentMessage,
        removeQueuedAgentMessage: async () => ({ agentId: "chat", revision: 3, items: [] }),
      };
      await fixture.flushQueueOutboxForServer({
        serverId: "host",
        client,
        applySnapshot: () => {},
      });
      expect(fixture.useQueueOutboxStore.getState().entries[entry.itemId]?.removalRequested).toBe(
        true,
      );
      expect(fixture.useQueueOutboxStore.getState().acknowledgements[entry.itemId]).toBeUndefined();
      await resetPersistedModules();
      const restarted = await import("./index");
      const drafts = (await import("@/stores/draft-store")).useDraftStore;
      await restarted.useQueueOutboxStore.persist.rehydrate();
      await drafts.persist.rehydrate();
      await restarted.useQueueOutboxStore.getState().recoverRoutingDraft();
      expect(drafts.getState().drafts[fixture.key]).toEqual(newerRecord);
      storage.failRemovalItem = undefined;
      await restarted.flushQueueOutboxForServer({
        serverId: "host",
        client,
        applySnapshot: () => {},
      });
      expect(restarted.useQueueOutboxStore.getState().entries[entry.itemId]).toBeUndefined();
      expect(drafts.getState().drafts[fixture.key]).toEqual(newerRecord);
      expect(JSON.parse(storage.values.get("paseo-drafts")!).state.drafts[fixture.key]).toEqual(
        newerRecord,
      );
      expect(fixture.enqueueAgentMessage).toHaveBeenCalledTimes(1);
    } finally {
      release();
      storage.draftHold = undefined;
      storage.failRemovalItem = undefined;
    }
  });
}

for (const caller of ["pushed snapshot", "background flush"] as const) {
  for (const draft of ["original", "newer identical", "newer different"] as const) {
    it(`${caller} retains ${draft} ownership when suppressed acknowledgement is followed by cancellation-write failure`, async () => {
      const fixture = await routingDispatchFixture(`suppressed-${caller}-${draft}`);
      fixture.enqueueAgentMessage.mockRejectedValueOnce(new Error("response lost"));
      await expect(fixture.deliverRoutedPrompt(fixture.input)).rejects.toThrow("response lost");
      const store = fixture.useQueueOutboxStore.getState();
      const entry = store.entries[fixture.input.itemId]!;
      const snapshot = {
        agentId: "chat",
        revision: 2,
        items: [{ id: entry.itemId, text: entry.text, createdAt: "2026-10-05T00:00:00.000Z" }],
      };
      let release!: () => void;
      storage.draftHold = new Promise<void>((done) => {
        release = done;
      });
      const removeQueuedAgentMessage = vi.fn(async () => ({
        agentId: "chat",
        revision: 3,
        items: [],
      }));
      const sessions = (await import("../session-store")).useSessionStore;
      sessions
        .getState()
        .initializeSession(
          "host",
          null as unknown as Parameters<
            ReturnType<typeof sessions.getState>["initializeSession"]
          >[1],
        );
      const snapshotApplications: Array<void | Promise<void>> = [];
      const applySnapshot = vi.fn((incoming: AgentQueueSnapshot) => {
        const application = sessions.getState().applyAgentQueueSnapshot("host", incoming);
        snapshotApplications.push(application);
        return application;
      });
      let applying: Promise<void> | void;
      if (caller === "pushed snapshot") {
        applying = sessions.getState().applyAgentQueueSnapshot("host", snapshot);
      } else {
        fixture.enqueueAgentMessage.mockResolvedValueOnce(snapshot);
        applying = fixture.flushQueueOutboxForServer({
          serverId: "host",
          client: { ...fixture.input.client, removeQueuedAgentMessage },
          applySnapshot,
        });
      }
      await vi.waitFor(() =>
        expect(fixture.useDraftStore.getState().drafts[fixture.key]?.routingClear?.itemId).toBe(
          entry.itemId,
        ),
      );
      if (draft !== "original")
        fixture.useDraftStore.getState().editDraftText({
          draftKey: fixture.key,
          text: draft === "newer identical" ? entry.text : "another prompt",
        });
      const expectedDraft =
        draft === "original"
          ? fixture.record
          : fixture.useDraftStore.getState().drafts[fixture.key]!;
      storage.failOnceKey = "paseo-queue-outbox";
      const removing = store.requestRemoval(entry).catch((error: Error) => error.message);
      release();
      try {
        expect(await removing).toBe("checkpoint failed");
        await applying;
        await Promise.all(snapshotApplications);
        if (caller === "background flush") expect(applySnapshot).not.toHaveBeenCalled();
        expect(
          sessions.getState().sessions.host.queuedMessageRevisions.get("chat"),
        ).toBeUndefined();
        storage.draftHold = undefined;
        expect(fixture.useQueueOutboxStore.getState().entries[entry.itemId]).toMatchObject({
          itemId: entry.itemId,
          routingDraftVersion: fixture.record.version,
          routingDraftUpdatedAt: fixture.record.updatedAt,
          text: entry.text,
        });
        expect(
          fixture.useQueueOutboxStore.getState().entries[entry.itemId]?.removalRequested,
        ).toBeUndefined();
        expect(
          fixture.useQueueOutboxStore.getState().acknowledgements[entry.itemId],
        ).toBeUndefined();
        expect(fixture.useQueueOutboxStore.getState().rejections[entry.itemId]).toBeUndefined();
        expect(removeQueuedAgentMessage).not.toHaveBeenCalled();
        await resetPersistedModules();
        const restarted = await import("./index");
        const drafts = (await import("@/stores/draft-store")).useDraftStore;
        await restarted.useQueueOutboxStore.persist.rehydrate();
        await drafts.persist.rehydrate();
        expect(restarted.useQueueOutboxStore.getState().entries[entry.itemId]).toMatchObject(entry);
        expect(drafts.getState().drafts[fixture.key]).toEqual(expectedDraft);
        expect(
          restarted.useQueueOutboxStore.getState().acknowledgements[entry.itemId],
        ).toBeUndefined();
        if (draft === "original") {
          const pending = restarted.useQueueOutboxStore.getState().entries[entry.itemId]!;
          const restoredDraft = drafts.getState().drafts[fixture.key]!;
          expect([pending.routingDraftVersion, pending.routingDraftUpdatedAt]).toEqual([
            restoredDraft.version,
            restoredDraft.updatedAt,
          ]);
        }
        const { deliverRoutedPrompt } =
          await import("@/components/sidebar/session-routing/delivery");
        fixture.enqueueAgentMessage.mockResolvedValueOnce(snapshot);
        expect(
          await deliverRoutedPrompt({
            ...fixture.input,
            requireExisting: true,
            outbox: restarted.useQueueOutboxStore.getState(),
          }),
        ).toEqual({ queued: true });
        expect(
          fixture.enqueueAgentMessage.mock.calls.every(
            ([input]) => input.itemId === entry.itemId && input.text === entry.text,
          ),
        ).toBe(true);
        expect(restarted.useQueueOutboxStore.getState().entries[entry.itemId]).toBeUndefined();
        expect(drafts.getState().getDraftInput(fixture.key)?.text).toBe(
          draft === "original" ? "" : expectedDraft.input.text,
        );
      } finally {
        release();
        storage.draftHold = undefined;
        storage.failOnceKey = undefined;
      }
    });
  }
}
