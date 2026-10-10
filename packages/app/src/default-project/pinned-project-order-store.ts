import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

/**
 * Drag order of pinned projects, per device, keyed by project view key. Kept beside the sidebar
 * order store rather than inside it so pinned projects keep their order in every sort mode, the
 * same way `pinnedWorkspaceOrder` does for pinned chats.
 */
interface PinnedProjectOrderState {
  pinnedProjectOrder: string[];
  setPinnedProjectOrder: (keys: string[]) => void;
}

const PersistedSchema = z.strictObject({
  pinnedProjectOrder: z.array(z.string()).optional(),
});

function dedupeKeys(keys: readonly string[]): string[] {
  const seen = new Set<string>();
  return keys.filter((key) => {
    if (!key.trim() || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const usePinnedProjectOrderStore = create<PinnedProjectOrderState>()(
  persist(
    (set) => ({
      pinnedProjectOrder: [],
      setPinnedProjectOrder: (keys) => set({ pinnedProjectOrder: dedupeKeys(keys) }),
    }),
    {
      name: "sidebar-pinned-project-order",
      storage: createValidatedPersistStorage(AsyncStorage, PersistedSchema),
      partialize: (state) => ({ pinnedProjectOrder: state.pinnedProjectOrder }),
      version: 1,
    },
  ),
);
