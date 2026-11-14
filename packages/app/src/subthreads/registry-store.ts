import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";
import { create } from "zustand";
import { persist, type StateStorage } from "zustand/middleware";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import type { SubthreadGroupKind } from "./model";

/**
 * What the person folded in the subagents registry, per device: each chat's two groups, and the
 * Spawned agents section of each pane's Questions and asks pane. A missing entry means "no
 * choice yet", so the defaults apply (`resolveGroupCollapsed`; the asks pane section starts
 * folded). Card expansion is view state and is never stored here.
 *
 * Its own storage key rather than a field on `answers-pane`, so it merges cleanly with the asks
 * pane's per-tab state whichever lands first, and an older build ignores it.
 */
export interface SubagentRegistryState {
  /** Chat key (`registryChatKey`) to its groups' collapsed flags. */
  groups: Record<string, Partial<Record<SubthreadGroupKind, boolean>>>;
  /** Asks pane key (`registryPaneKey`) to whether its Spawned agents section is folded. */
  asksSections: Record<string, boolean>;
  setGroupCollapsed: (chatKey: string, kind: SubthreadGroupKind, collapsed: boolean) => void;
  setAsksSectionCollapsed: (paneKey: string, collapsed: boolean) => void;
}

/**
 * Each map keeps the newest entries only. A chat or pane nobody opens again should not hold
 * storage forever, and a choice a person made recently is the one worth keeping.
 */
export const REGISTRY_MAX_ENTRIES = 300;

const GroupFlagsSchema = z
  .object({ paseo: z.boolean().optional(), provider: z.boolean().optional() })
  .strict();

const PersistedRegistrySchema = z
  .object({
    groups: z.record(z.string(), GroupFlagsSchema),
    asksSections: z.record(z.string(), z.boolean()),
  })
  .strict();

type PersistedRegistry = z.infer<typeof PersistedRegistrySchema>;

/** Per chat: the same orchestrator shows the same folds in every pane it is open in. */
export function registryChatKey(serverId: string, agentId: string): string {
  return JSON.stringify([serverId, agentId]);
}

/**
 * Per pane, in the asks pane's own key shape (host, workspace, tab, chat), so the same chat in two
 * splits keeps two choices.
 */
export function registryPaneKey(
  serverId: string,
  workspaceId: string | null,
  tabId: string | null,
  agentId: string,
): string {
  return JSON.stringify([serverId, workspaceId, tabId, agentId]);
}

/** Moves `key` to the newest position and drops the oldest entries past the cap. */
function withNewest<T>(record: Record<string, T>, key: string, value: T): Record<string, T> {
  const next: Record<string, T> = {};
  const keys = Object.keys(record).filter((existing) => existing !== key);
  for (const existing of keys.slice(Math.max(0, keys.length - (REGISTRY_MAX_ENTRIES - 1)))) {
    next[existing] = record[existing]!;
  }
  next[key] = value;
  return next;
}

/** Storage is injectable so persistence can be tested against a real in-memory backend. */
export function createSubagentRegistryStore(storage: StateStorage) {
  return create<SubagentRegistryState>()(
    persist<SubagentRegistryState, [], [], PersistedRegistry>(
      (set) => ({
        groups: {},
        asksSections: {},
        setGroupCollapsed: (chatKey, kind, collapsed) =>
          set((state) => ({
            groups: withNewest(state.groups, chatKey, {
              ...state.groups[chatKey],
              [kind]: collapsed,
            }),
          })),
        setAsksSectionCollapsed: (paneKey, collapsed) =>
          set((state) => ({ asksSections: withNewest(state.asksSections, paneKey, collapsed) })),
      }),
      {
        name: "subagent-registry",
        storage: createValidatedPersistStorage(storage, PersistedRegistrySchema),
        partialize: (state) => ({ groups: state.groups, asksSections: state.asksSections }),
      },
    ),
  );
}

export const useSubagentRegistryStore = createSubagentRegistryStore(AsyncStorage);
