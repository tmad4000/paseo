import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import type { TabLocalLeafSize } from "@/tab-local-splits/actions";
import type { TabLocalLayouts } from "@/tab-local-splits/model";
import type { TabLocalPendingFill } from "@/tab-local-splits/normalize";
import {
  TAB_LOCAL_SPLITS_PERSIST_VERSION,
  TAB_LOCAL_SPLITS_STORAGE_KEY,
  TabLocalSplitsPersistedStateSchema,
  type TabLocalSplitsPersistedState,
} from "@/tab-local-splits/storage";

interface TabLocalSplitsStore extends TabLocalSplitsPersistedState {
  /** Zoom is ephemeral, like upstream's pane maximize: keyed by `compositeKey`. */
  zoomedLeafByComposite: Record<string, string>;
  /** Choosers waiting for a tab the launcher is creating. */
  pendingFillsByWorkspace: Record<string, TabLocalPendingFill[]>;
  /** Last measured box of each rendered composite, for the minimum-leaf-size check. */
  sizeByComposite: Record<string, TabLocalLeafSize>;
  setLayouts: (workspaceKey: string, layouts: TabLocalLayouts) => void;
  setZoomedLeaf: (workspaceKey: string, hostTabId: string, leafId: string | null) => void;
  setPendingFills: (workspaceKey: string, fills: TabLocalPendingFill[]) => void;
  setCompositeSize: (workspaceKey: string, hostTabId: string, size: TabLocalLeafSize) => void;
}

const EMPTY_LAYOUTS: TabLocalLayouts = {};

export function compositeKey(workspaceKey: string, hostTabId: string): string {
  return `${workspaceKey}\u0000${hostTabId}`;
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = record;
  return rest;
}

export const useTabLocalSplitsStore = create<TabLocalSplitsStore>()(
  persist(
    (set) => ({
      layoutsByWorkspace: {},
      zoomedLeafByComposite: {},
      pendingFillsByWorkspace: {},
      sizeByComposite: {},
      setLayouts: (workspaceKey, layouts) =>
        set((state) => {
          if (state.layoutsByWorkspace[workspaceKey] === layouts) return state;
          return {
            layoutsByWorkspace:
              Object.keys(layouts).length === 0
                ? withoutKey(state.layoutsByWorkspace, workspaceKey)
                : { ...state.layoutsByWorkspace, [workspaceKey]: layouts },
          };
        }),
      setZoomedLeaf: (workspaceKey, hostTabId, leafId) =>
        set((state) => {
          const key = compositeKey(workspaceKey, hostTabId);
          if ((state.zoomedLeafByComposite[key] ?? null) === leafId) return state;
          return {
            zoomedLeafByComposite: leafId
              ? { ...state.zoomedLeafByComposite, [key]: leafId }
              : withoutKey(state.zoomedLeafByComposite, key),
          };
        }),
      setPendingFills: (workspaceKey, fills) =>
        set((state) => ({
          pendingFillsByWorkspace:
            fills.length === 0
              ? withoutKey(state.pendingFillsByWorkspace, workspaceKey)
              : { ...state.pendingFillsByWorkspace, [workspaceKey]: fills },
        })),
      setCompositeSize: (workspaceKey, hostTabId, size) =>
        set((state) => {
          const key = compositeKey(workspaceKey, hostTabId);
          const current = state.sizeByComposite[key];
          if (current?.width === size.width && current.height === size.height) return state;
          return { sizeByComposite: { ...state.sizeByComposite, [key]: size } };
        }),
    }),
    {
      name: TAB_LOCAL_SPLITS_STORAGE_KEY,
      version: TAB_LOCAL_SPLITS_PERSIST_VERSION,
      storage: createValidatedPersistStorage(AsyncStorage, TabLocalSplitsPersistedStateSchema),
      partialize: (state) => ({ layoutsByWorkspace: state.layoutsByWorkspace }),
    },
  ),
);

export function selectWorkspaceTabLocalLayouts(
  state: Pick<TabLocalSplitsStore, "layoutsByWorkspace">,
  workspaceKey: string | null,
): TabLocalLayouts {
  return (workspaceKey ? state.layoutsByWorkspace[workspaceKey] : undefined) ?? EMPTY_LAYOUTS;
}

export function useWorkspaceTabLocalLayouts(workspaceKey: string | null): TabLocalLayouts {
  return useTabLocalSplitsStore((state) => selectWorkspaceTabLocalLayouts(state, workspaceKey));
}

export function useTabLocalSplitsStoreHydrated(): boolean {
  const [hydrated, setHydrated] = useState(() => useTabLocalSplitsStore.persist.hasHydrated());
  useEffect(() => {
    if (useTabLocalSplitsStore.persist.hasHydrated()) {
      setHydrated(true);
      return;
    }
    return useTabLocalSplitsStore.persist.onFinishHydration(() => setHydrated(true));
  }, []);
  return hydrated;
}
