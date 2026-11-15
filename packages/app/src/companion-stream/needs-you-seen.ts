import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { GlobalStreamRow } from "./use-global-stream";

export const needsYouIdentity = (row: GlobalStreamRow) =>
  JSON.stringify([row.serverId, row.agentId, row.id]);
export const needsYouRevision = (row: GlobalStreamRow) =>
  row.item.kind === "entry"
    ? JSON.stringify([
        row.timestamp,
        row.item.entry.ask?.revision,
        row.item.entry.text,
        "status" in row.item.entry ? row.item.entry.status : undefined,
      ])
    : row.timestamp;
const pendingSeen: GlobalStreamRow[] = [];
interface SeenState {
  hydrated: boolean;
  finishHydration: () => void;
  seen: Record<string, string>;
  markSeen: (rows: GlobalStreamRow[]) => void;
}
/** Device-local view state, independent of task completion and answer review. */
export const useNeedsYouSeen = create<SeenState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      finishHydration: () => {
        set({ hydrated: true });
        get().markSeen(pendingSeen.splice(0));
      },
      seen: {},
      markSeen: (rows) => {
        if (!get().hydrated) {
          pendingSeen.push(...rows);
          return;
        }
        set((state) => {
          const changed = rows.filter(
            (row) => state.seen[needsYouIdentity(row)] !== needsYouRevision(row),
          );
          if (!changed.length) return state;
          return {
            seen: {
              ...state.seen,
              ...Object.fromEntries(
                changed.map((row) => [needsYouIdentity(row), needsYouRevision(row)]),
              ),
            },
          };
        });
      },
    }),
    {
      name: "paseo:needs-you-seen:v1",
      storage: createJSONStorage(() => AsyncStorage),
      onRehydrateStorage: () => (state) => {
        if (state) state.finishHydration();
        else queueMicrotask(() => useNeedsYouSeen.getState().finishHydration());
      },
      merge: (persisted, current) => {
        const candidate = (persisted as { seen?: unknown } | null)?.seen;
        const seen =
          candidate && typeof candidate === "object"
            ? Object.fromEntries(
                Object.entries(candidate).filter(([, value]) => typeof value === "string"),
              )
            : {};
        return { ...current, seen };
      },
      partialize: ({ seen }) => ({ seen }),
    },
  ),
);
