import { create } from "zustand";
import { persist } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";

import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import {
  addClientDiagnostic,
  applyClientDiagnosticAck,
  PendingClientDiagnosticSchema,
  selectClientDiagnosticBatch,
  toWireDiagnostic,
  type ClientDiagnosticInput,
  type PendingClientDiagnostic,
} from "./model";
import { setClientDiagnosticSink } from "./record";

const PersistedClientDiagnosticsSchema = z.object({
  entries: z.array(PendingClientDiagnosticSchema),
});

interface ClientDiagnosticsState {
  entries: PendingClientDiagnostic[];
}

/** Device-side queue of error diagnostics waiting for a host. Survives restarts and offline time. */
export const useClientDiagnosticsStore = create<ClientDiagnosticsState>()(
  persist(() => ({ entries: [] as PendingClientDiagnostic[] }), {
    name: "paseo-client-diagnostics",
    version: 1,
    storage: createValidatedPersistStorage(AsyncStorage, PersistedClientDiagnosticsSchema),
    partialize: ({ entries }) => ({ entries }),
    // Hydration happens in installClientDiagnostics, after anything recorded early is buffered.
    skipHydration: true,
  }),
);

export interface ClientDiagnosticsReporter {
  reportClientDiagnostics(input: {
    deviceLabel?: string;
    platform?: string;
    events: ReturnType<typeof toWireDiagnostic>[];
  }): Promise<{ acknowledgedIds: string[]; deferredIds: string[] }>;
}

type FlushListener = () => void;
const flushListeners = new Set<FlushListener>();
let idCounter = 0;

function createId(): string {
  idCounter = (idCounter + 1) % 1_000_000;
  const random = Math.random().toString(36).slice(2, 10);
  return `cd-${Date.now().toString(36)}-${idCounter.toString(36)}-${random}`;
}

/** Adds a diagnostic to the persisted queue. Only valid after hydration (see install). */
export function addPendingClientDiagnostic(input: ClientDiagnosticInput, now = Date.now()): void {
  const state = useClientDiagnosticsStore.getState();
  useClientDiagnosticsStore.setState({
    entries: addClientDiagnostic(state.entries, input, { now, createId }),
  });
  for (const listener of flushListeners) listener();
}

/** Called when a new diagnostic is queued, so a connected host can be sent it promptly. */
export function onClientDiagnosticQueued(listener: FlushListener): () => void {
  flushListeners.add(listener);
  return () => flushListeners.delete(listener);
}

let installPromise: Promise<void> | null = null;

/**
 * Hydrates the saved queue, then routes recorded diagnostics into it. Recordings made before
 * hydration finishes are buffered by the recorder and replayed, so saved entries are never
 * overwritten by an empty initial state.
 */
export function installClientDiagnostics(): Promise<void> {
  installPromise ??= Promise.resolve(useClientDiagnosticsStore.persist.rehydrate())
    .catch(() => undefined)
    .then(() => {
      setClientDiagnosticSink((input) => addPendingClientDiagnostic(input));
      return undefined;
    });
  return installPromise;
}

const inFlight = new Map<string, Promise<void>>();

/**
 * Sends this host the diagnostics it should receive, in batches, and forgets what it
 * acknowledged. Deferred (rate-limited) ones stay for a later flush. One flush per host at a time.
 */
export function flushClientDiagnosticsForServer(input: {
  serverId: string;
  client: ClientDiagnosticsReporter;
  device: { deviceLabel: string; platform: string };
  maxBatches?: number;
}): Promise<void> {
  const running = inFlight.get(input.serverId);
  if (running) return running;
  const run = (async () => {
    if (!useClientDiagnosticsStore.persist.hasHydrated()) return;
    for (let batch = 0; batch < (input.maxBatches ?? 4); batch += 1) {
      const sent = selectClientDiagnosticBatch(
        useClientDiagnosticsStore.getState().entries,
        input.serverId,
      );
      if (sent.length === 0) return;
      const result = await input.client.reportClientDiagnostics({
        ...input.device,
        events: sent.map(toWireDiagnostic),
      });
      useClientDiagnosticsStore.setState({
        entries: applyClientDiagnosticAck(
          useClientDiagnosticsStore.getState().entries,
          sent,
          result.acknowledgedIds,
        ),
      });
      // The host is rate limiting this device; try again on a later flush.
      if (result.deferredIds.length > 0 || result.acknowledgedIds.length === 0) return;
    }
  })().finally(() => inFlight.delete(input.serverId));
  inFlight.set(input.serverId, run);
  return run;
}
