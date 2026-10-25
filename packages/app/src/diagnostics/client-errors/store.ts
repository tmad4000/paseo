import { create } from "zustand";
import { persist } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";

import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import {
  addClientDiagnostic,
  applyClientDiagnosticAck,
  claimClientDiagnostics,
  PendingClientDiagnosticSchema,
  pruneExpiredClientDiagnostics,
  releaseClientDiagnosticClaims,
  selectClientDiagnosticBatch,
  toWireDiagnostic,
  type ClientDiagnosticInput,
  type PendingClientDiagnostic,
} from "./model";
import { setClientDiagnosticSink } from "./record";
import type { ClientDiagnosticsFlushOutcome } from "./scheduler";

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
export function installClientDiagnostics(now: () => number = Date.now): Promise<void> {
  installPromise ??= Promise.resolve(useClientDiagnosticsStore.persist.rehydrate())
    .catch(() => undefined)
    .then(() => {
      // Nothing was being sent across a restart, and an old backlog must not outlive its limit.
      useClientDiagnosticsStore.setState({
        entries: releaseClientDiagnosticClaims(
          pruneExpiredClientDiagnostics(useClientDiagnosticsStore.getState().entries, now()),
        ),
      });
      setClientDiagnosticSink((input) => addPendingClientDiagnostic(input));
      // A host may have connected (and flushed nothing) while the saved backlog was still loading.
      if (useClientDiagnosticsStore.getState().entries.length > 0) {
        for (const listener of flushListeners) listener();
      }
      return undefined;
    });
  return installPromise;
}

const inFlight = new Map<string, Promise<ClientDiagnosticsFlushOutcome>>();

function updateEntries(update: (entries: PendingClientDiagnostic[]) => PendingClientDiagnostic[]) {
  useClientDiagnosticsStore.setState({
    entries: update(useClientDiagnosticsStore.getState().entries),
  });
}

/**
 * Sends this host the diagnostics it should receive, in batches, and forgets what it
 * acknowledged. Unassigned diagnostics are claimed for this host before sending, so a concurrent
 * flush to another host cannot send them too; unacknowledged claims are released afterwards.
 * Deferred (rate-limited) diagnostics stay queued; the caller schedules the retry from the outcome.
 * One flush per host at a time.
 */
export function flushClientDiagnosticsForServer(input: {
  serverId: string;
  client: ClientDiagnosticsReporter;
  device: { deviceLabel: string; platform: string };
  maxBatches?: number;
  now?: () => number;
}): Promise<ClientDiagnosticsFlushOutcome> {
  const running = inFlight.get(input.serverId);
  if (running) return running;
  const now = input.now ?? Date.now;
  const run = (async (): Promise<ClientDiagnosticsFlushOutcome> => {
    // A host can connect before the saved queue has loaded on a cold start. Wait for it rather
    // than reporting "skipped", which the scheduler treats as disconnected and stops retrying.
    if (!useClientDiagnosticsStore.persist.hasHydrated()) await installClientDiagnostics();
    if (!useClientDiagnosticsStore.persist.hasHydrated()) return "skipped";
    updateEntries((entries) => pruneExpiredClientDiagnostics(entries, now()));
    for (let batch = 0; batch < (input.maxBatches ?? 4); batch += 1) {
      const sent = selectClientDiagnosticBatch(
        useClientDiagnosticsStore.getState().entries,
        input.serverId,
        now(),
      );
      if (sent.length === 0) return "delivered";
      updateEntries((entries) => claimClientDiagnostics(entries, sent, input.serverId));
      const sentIds = new Set(sent.map((entry) => entry.id));
      let acknowledged: string[] = [];
      try {
        const result = await input.client.reportClientDiagnostics({
          ...input.device,
          events: sent.map(toWireDiagnostic),
        });
        acknowledged = result.acknowledgedIds;
        updateEntries((entries) => applyClientDiagnosticAck(entries, sent, acknowledged));
        if (result.deferredIds.length > 0 || acknowledged.length === 0) return "deferred";
      } finally {
        updateEntries((entries) => releaseClientDiagnosticClaims(entries, sentIds));
      }
    }
    const remaining = selectClientDiagnosticBatch(
      useClientDiagnosticsStore.getState().entries,
      input.serverId,
      now(),
    );
    return remaining.length > 0 ? "more" : "delivered";
  })().finally(() => inFlight.delete(input.serverId));
  inFlight.set(input.serverId, run);
  return run;
}
