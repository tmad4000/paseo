import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import { touchRecentVisit, type RecentVisit } from "@/navigation/recent-workspaces";

export const RECENT_VISITS_STORAGE_KEY = "paseo:recent-visits";

const RecentVisitsPersistedStateSchema = z.strictObject({
  visits: z.array(
    z.strictObject({
      serverId: z.string().min(1),
      workspaceId: z.string().min(1),
      agentId: z.string().min(1).nullable(),
      visitedAt: z.number(),
    }),
  ),
});

interface RecentVisitsState {
  /** Most recent first. Derive workspaces and sessions with the helpers in recent-workspaces. */
  visits: readonly RecentVisit[];
  touch(visit: Omit<RecentVisit, "visitedAt">, now?: number): void;
}

export const useRecentVisitsStore = create<RecentVisitsState>()(
  persist(
    (set) => ({
      visits: [],
      touch: (visit, now = Date.now()) =>
        set((state) => {
          const visits = touchRecentVisit(state.visits, { ...visit, visitedAt: now });
          return visits === state.visits ? state : { visits };
        }),
    }),
    {
      name: RECENT_VISITS_STORAGE_KEY,
      version: 1,
      storage: createValidatedPersistStorage(AsyncStorage, RecentVisitsPersistedStateSchema),
      partialize: (state) => ({ visits: [...state.visits] }),
      // A visit made before storage finished loading is newer than anything stored.
      merge: (persisted, current) => {
        let visits: readonly RecentVisit[] =
          (persisted as { visits?: RecentVisit[] } | undefined)?.visits ?? [];
        for (const visit of current.visits.toReversed()) {
          visits = touchRecentVisit(visits, visit);
        }
        return { ...current, visits };
      },
    },
  ),
);
