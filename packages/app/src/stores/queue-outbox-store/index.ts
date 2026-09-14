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
  add: (entry: Omit<PendingQueueEnqueue, "createdAt" | "attempts">) => void;
  remove: (itemId: string) => void;
  bumpAttempts: (itemId: string) => void;
  entriesForServer: (serverId: string) => PendingQueueEnqueue[];
  entriesForAgent: (serverId: string, agentId: string) => PendingQueueEnqueue[];
}

type QueueOutboxStore = PersistedQueueOutbox & QueueOutboxActions;

function sortByCreation(entries: PendingQueueEnqueue[]): PendingQueueEnqueue[] {
  return entries.sort((a, b) => a.createdAt - b.createdAt);
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

      add: (entry) => {
        set((state) => ({
          entries: {
            ...state.entries,
            [entry.itemId]: { ...entry, createdAt: Date.now(), attempts: 0 },
          },
        }));
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
      storage: createValidatedPersistStorage(AsyncStorage, PersistedQueueOutboxSchema),
      partialize: ({ entries }) => ({ entries }),
    },
  ),
);

const flushesInFlight = new Set<string>();

/**
 * Flushes this store's un-acked enqueues for one server. Called on every
 * (re)connect that advertises `agentMessageQueue`; concurrent calls for the
 * same server coalesce so a burst of status messages cannot double-send.
 */
export async function flushQueueOutboxForServer(input: {
  serverId: string;
  client: QueueOutboxFlushClient;
  applySnapshot: (snapshot: AgentQueueSnapshot) => void;
  onDropEntry?: (entry: PendingQueueEnqueue) => void;
}): Promise<void> {
  if (flushesInFlight.has(input.serverId)) {
    return;
  }
  flushesInFlight.add(input.serverId);
  try {
    const store = useQueueOutboxStore.getState();
    await flushQueueOutbox({
      serverId: input.serverId,
      outbox: {
        list: (serverId) => useQueueOutboxStore.getState().entriesForServer(serverId),
        remove: store.remove,
        bumpAttempts: store.bumpAttempts,
      },
      client: input.client,
      applySnapshot: input.applySnapshot,
      ...(input.onDropEntry ? { onDropEntry: input.onDropEntry } : {}),
    });
  } finally {
    flushesInFlight.delete(input.serverId);
  }
}
