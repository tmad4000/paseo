import { create } from "zustand";
import { persist } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";

import { createOutboxWriteTracker } from "@/stores/outbox-write";
import { flushDeliveryOutboxes } from "@/stores/delivery-outboxes";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import { awaitDeliveryOrderHydration, nextDeliveryCreatedAt } from "@/stores/delivery-order";
import type { QueueOutboxFlushClient } from "@/stores/queue-outbox-store/model";
import { createMessageSubmissionWriter } from "@/composer/submission/writer";
import { serializeQueueOperation } from "@/stores/queue-outbox-store/model";
import {
  flushSendOutbox,
  isUncertainSendOutcome,
  PendingDirectSendSchema,
  type PendingDirectSend,
  type SendOutboxFlushClient,
} from "./model";

export {
  SEND_OUTBOX_MAX_ATTEMPTS,
  isDefinitiveSendFailure,
  isUncertainSendOutcome,
  canEditRefusedSend,
  supportsDurableDirectSend,
  type PendingDirectSend,
} from "./model";

const PersistedSendOutboxSchema = z.object({
  entries: z.record(z.string(), PendingDirectSendSchema),
  /**
   * Hosts last seen deduping retried sends. Lets a cold start with the host
   * unreachable (features unknown) still store a send before attempting it.
   */
  durableHosts: z.record(z.string(), z.literal(true)).optional(),
});

type PersistedSendOutbox = z.infer<typeof PersistedSendOutboxSchema>;

interface SendOutboxActions {
  add: (entry: Omit<PendingDirectSend, "createdAt" | "attempts">) => Promise<void>;
  removeDurably: (clientMessageId: string) => Promise<void>;
  bumpAttemptsDurably: (clientMessageId: string) => Promise<void>;
  markRejectedDurably: (clientMessageId: string, error: string) => Promise<void>;
  /** Clears a refusal so the next flush resends the identical request. */
  clearRejectionDurably: (clientMessageId: string) => Promise<void>;
  entriesForServer: (serverId: string) => PendingDirectSend[];
  rememberHostSupport: (serverId: string, supported: boolean) => Promise<void>;
}

type SendOutboxStore = PersistedSendOutbox & SendOutboxActions;

const MUTATION_KEY = "send-outbox-mutation";

const writesInFlight = createOutboxWriteTracker<PendingDirectSend>();

export function pendingSendOutboxWrite(clientMessageId: string): Promise<void> | undefined {
  return writesInFlight.pending(clientMessageId);
}

export function sendOutboxDeliveryEntries(): PendingDirectSend[] {
  return writesInFlight.entries(useSendOutboxStore.getState().entries);
}

let pendingWrite: Promise<void> = Promise.resolve();
const persistedStorage = createValidatedPersistStorage(AsyncStorage, PersistedSendOutboxSchema);
const durableStorage: typeof persistedStorage = {
  ...persistedStorage,
  setItem: (name, value) => {
    pendingWrite = pendingWrite
      .catch(() => {})
      .then(async () => {
        await persistedStorage.setItem(name, value);
        return undefined;
      });
    void pendingWrite.catch(() => {});
    return pendingWrite;
  },
};

let hydrationInFlight: Promise<void> | undefined;
export async function awaitSendOutboxHydration(): Promise<void> {
  if (useSendOutboxStore.persist.hasHydrated()) return;
  hydrationInFlight ??= Promise.resolve(useSendOutboxStore.persist.rehydrate()).finally(() => {
    hydrationInFlight = undefined;
  });
  await hydrationInFlight;
  if (!useSendOutboxStore.persist.hasHydrated())
    throw new Error("Unable to load saved unsent messages");
}

/**
 * Durable direct sends. Entries are keyed by client message id, which is also
 * the id the host dedupes on, and survive app restarts.
 */
export const useSendOutboxStore = create<SendOutboxStore>()(
  persist(
    (set, get) => {
      const replaceDurably = async (
        clientMessageId: string,
        update: (entry: PendingDirectSend) => PendingDirectSend | null,
      ) =>
        serializeQueueOperation(MUTATION_KEY, async () => {
          await awaitSendOutboxHydration();
          const previous = get().entries[clientMessageId];
          if (!previous) return;
          const finishWrite = writesInFlight.retain(clientMessageId, previous);
          const next = update(previous);
          const entries = { ...get().entries };
          if (next) entries[clientMessageId] = next;
          else delete entries[clientMessageId];
          set({ entries });
          try {
            await pendingWrite;
          } catch (error) {
            set({ entries: { ...get().entries, [clientMessageId]: previous } });
            await pendingWrite.catch(() => {});
            throw error;
          } finally {
            finishWrite();
          }
        });

      return {
        entries: {},
        add: (entry) =>
          serializeQueueOperation(MUTATION_KEY, async () => {
            await awaitSendOutboxHydration();
            await awaitDeliveryOrderHydration();
            const saved = { ...entry, createdAt: nextDeliveryCreatedAt(), attempts: 0 };
            const finishWrite = writesInFlight.retain(entry.clientMessageId, saved);
            set((state) => ({
              entries: { ...state.entries, [entry.clientMessageId]: saved },
            }));
            try {
              await pendingWrite;
            } catch (error) {
              const entries = { ...get().entries };
              delete entries[entry.clientMessageId];
              set({ entries });
              throw error;
            } finally {
              finishWrite();
            }
          }),
        removeDurably: (clientMessageId) => replaceDurably(clientMessageId, () => null),
        bumpAttemptsDurably: (clientMessageId) =>
          replaceDurably(clientMessageId, (entry) => ({ ...entry, attempts: entry.attempts + 1 })),
        markRejectedDurably: (clientMessageId, error) =>
          replaceDurably(clientMessageId, (entry) => ({ ...entry, rejectedError: error })),
        clearRejectionDurably: (clientMessageId) =>
          replaceDurably(clientMessageId, ({ rejectedError: _rejected, ...entry }) => ({
            ...entry,
            attempts: 0,
          })),
        // Never set() before hydration: persist would write the empty initial
        // state over the saved entries (reproduced: a reconnect right after a
        // cold start wiped an unsent message).
        rememberHostSupport: (serverId, supported) =>
          serializeQueueOperation(MUTATION_KEY, async () => {
            await awaitSendOutboxHydration();
            const known = get().durableHosts?.[serverId] === true;
            if (known === supported) return;
            const durableHosts = { ...get().durableHosts };
            if (supported) durableHosts[serverId] = true;
            else delete durableHosts[serverId];
            set({ durableHosts });
            await pendingWrite;
          }),
        entriesForServer: (serverId) =>
          Object.values(get().entries)
            .filter(
              (entry) => entry.serverId === serverId && !writesInFlight.has(entry.clientMessageId),
            )
            .sort((a, b) => a.createdAt - b.createdAt),
      };
    },
    {
      name: "paseo-send-outbox",
      version: 1,
      storage: durableStorage,
      partialize: ({ entries, durableHosts }) => ({ entries, durableHosts }),
    },
  ),
);

export interface SendOutboxServerInput {
  serverId: string;
  agentId?: string;
  client: SendOutboxFlushClient & Partial<QueueOutboxFlushClient>;
  onAccepted?: (entry: PendingDirectSend, result: { queued: boolean }) => void;
  onRejected?: (entry: PendingDirectSend, message: string) => void;
  onRetryLimit?: (entry: PendingDirectSend) => void;
}

export async function flushSendOutboxForServer(input: SendOutboxServerInput): Promise<void> {
  await flushDeliveryOutboxes({ ...input, direct: input });
}

export async function flushSendOutboxEntriesForServer(
  input: SendOutboxServerInput & { clientMessageId?: string },
): Promise<void> {
  await awaitSendOutboxHydration();
  const store = useSendOutboxStore.getState();
  await flushSendOutbox({
    ...input,
    onRejected: (entry, message) => {
      if (!isUncertainSendOutcome(message)) {
        createMessageSubmissionWriter(input.serverId).reject(entry.agentId, entry.clientMessageId);
      }
      input.onRejected?.(entry, message);
    },
    outbox: {
      list: (serverId) => useSendOutboxStore.getState().entriesForServer(serverId),
      get: (clientMessageId) => useSendOutboxStore.getState().entries[clientMessageId],
      remove: store.removeDurably,
      bumpAttempts: store.bumpAttemptsDurably,
      markRejected: store.markRejectedDurably,
    },
  });
}
