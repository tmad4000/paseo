import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import {
  touchRecentWorkspace,
  type RecentWorkspace,
  type RecentWorkspaceKeyInput,
} from "@/navigation/recent-workspaces";

export const RECENT_WORKSPACES_STORAGE_KEY = "paseo:recent-workspaces";

const RecentWorkspacesPersistedStateSchema = z.strictObject({
  recent: z.array(
    z.strictObject({
      serverId: z.string().min(1),
      workspaceId: z.string().min(1),
      visitedAt: z.number(),
    }),
  ),
});

interface RecentWorkspacesState {
  recent: readonly RecentWorkspace[];
  touch(workspace: RecentWorkspaceKeyInput, now?: number): void;
}

export const useRecentWorkspacesStore = create<RecentWorkspacesState>()(
  persist(
    (set) => ({
      recent: [],
      touch: (workspace, now = Date.now()) =>
        set((state) => {
          const recent = touchRecentWorkspace(state.recent, { ...workspace, visitedAt: now });
          return recent === state.recent ? state : { recent };
        }),
    }),
    {
      name: RECENT_WORKSPACES_STORAGE_KEY,
      version: 1,
      storage: createValidatedPersistStorage(AsyncStorage, RecentWorkspacesPersistedStateSchema),
      partialize: (state) => ({ recent: [...state.recent] }),
      // A workspace opened before storage finished loading is newer than anything stored.
      merge: (persisted, current) => {
        let recent: readonly RecentWorkspace[] =
          (persisted as { recent?: RecentWorkspace[] } | undefined)?.recent ?? [];
        for (const visit of current.recent.toReversed()) {
          recent = touchRecentWorkspace(recent, visit);
        }
        return { ...current, recent };
      },
    },
  ),
);
