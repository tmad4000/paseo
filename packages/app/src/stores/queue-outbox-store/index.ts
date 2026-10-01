import { create } from "zustand";
import { persist } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";
import type { AgentQueueSnapshot } from "@getpaseo/protocol/messages";

import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import {
  flushQueueOutbox,
  PendingQueueEnqueueSchema,
  type PendingQueueEnqueue,
  type QueueOutboxFlushClient,
} from "./model";

export {
  QUEUE_OUTBOX_MAX_ATTEMPTS,
  type PendingQueueEnqueue,
  type QueueOutboxFlushClient,
} from "./model";

const PersistedQueueOutboxSchema = z.object({
  entries: z.record(z.string(), PendingQueueEnqueueSchema),
});

type PersistedQueueOutbox = z.infer<typeof PersistedQueueOutboxSchema>;

interface QueueOutboxActions {
  add: (entry: Omit<PendingQueueEnqueue, "createdAt" | "attempts">) => Promise<void>;
  remove: (itemId: string) => void;
  bumpAttempts: (itemId: string) => void;
  entriesForServer: (serverId: string) => PendingQueueEnqueue[];
  entriesForAgent: (serverId: string, agentId: string) => PendingQueueEnqueue[];
}

type QueueOutboxStore = PersistedQueueOutbox & QueueOutboxActions;

function sortByCreation(entries: PendingQueueEnqueue[]): PendingQueueEnqueue[] {
  return entries.sort((a, b) => a.createdAt - b.createdAt);
}

let pendingWrite: Promise<void> = Promise.resolve();
const persistedStorage = createValidatedPersistStorage(AsyncStorage, PersistedQueueOutboxSchema);
const durableStorage: typeof persistedStorage = {
  ...persistedStorage,
  setItem: (name, value) => {
    pendingWrite = pendingWrite.catch(() => {}).then(async () => {
      await persistedStorage.setItem(name, value);
    });
    void pendingWrite.catch(() => {});
    return pendingWrite;
  },
};

let hydrationInFlight: Promise<void> | undefined;
async function awaitOutboxHydration(): Promise<void> {
  if (useQueueOutboxStore.persist.hasHydrated()) return;
  hydrationInFlight ??= Promise.resolve(useQueueOutboxStore.persist.rehydrate()).then(() => {
    if (!useQueueOutboxStore.persist.hasHydrated()) throw new Error("Unable to load saved queued messages");
  }).finally(() => { hydrationInFlight = undefined; });
  await hydrationInFlight;
  if (!useQueueOutboxStore.persist.hasHydrated()) throw new Error("Unable to load saved queued messages");
}

/**
 * The durable outbox for daemon-owned queue writes. Entries are keyed by item
 * id (unique across servers by construction) and survive app restarts, so an
 * enqueue that never reached the daemon is retried instead of lost.
 */
export const useQueueOutboxStore = create<QueueOutboxStore>()(
  persist(
    (set, get) => ({
      entries: {},

      add: async (entry) => {
        await awaitOutboxHydration();
        set((state) => ({
          entries: {
            ...state.entries,
            [entry.itemId]: { ...entry, createdAt: Date.now(), attempts: 0 },
          },
        }));
        try {
          await pendingWrite;
        } catch (error) {
          get().remove(entry.itemId);
          throw error;
        }
      },

      remove: (itemId) => {
        set((state) => {
          if (!(itemId in state.entries)) {
            return state;
          }
          const entries = { ...state.entries };
          delete entries[itemId];
          return { entries };
        });
      },

      bumpAttempts: (itemId) => {
        set((state) => {
          const entry = state.entries[itemId];
          if (!entry) {
            return state;
          }
          return {
            entries: {
              ...state.entries,
              [itemId]: { ...entry, attempts: entry.attempts + 1 },
            },
          };
        });
      },

      entriesForServer: (serverId) =>
        sortByCreation(Object.values(get().entries).filter((entry) => entry.serverId === serverId)),

      entriesForAgent: (serverId, agentId) =>
        sortByCreation(
          Object.values(get().entries).filter(
            (entry) => entry.serverId === serverId && entry.agentId === agentId,
          ),
        ),
    }),
    {
      name: "paseo-queue-outbox",
      version: 1,
      storage: durableStorage,
      partialize: ({ entries }) => ({ entries }),
    },
  ),
);

export async function flushQueueOutboxForServer(input: {
  serverId: string;
  client: QueueOutboxFlushClient;
  applySnapshot: (snapshot: AgentQueueSnapshot) => void;
  onRetryLimit?: (entry: PendingQueueEnqueue) => void;
}): Promise<void> {
  await awaitOutboxHydration();
  const store = useQueueOutboxStore.getState();
  await flushQueueOutbox({
    ...input,
    outbox: {
      list: (serverId) => useQueueOutboxStore.getState().entriesForServer(serverId),
      remove: store.remove,
      bumpAttempts: store.bumpAttempts,
    },
  });
}
