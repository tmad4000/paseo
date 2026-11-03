import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

const PersistedSchema = z.object({ enabled: z.boolean(), collapsed: z.boolean() });
type Persisted = z.infer<typeof PersistedSchema>;

interface NeedsYouSectionState extends Persisted {
  setEnabled: (enabled: boolean) => void;
  toggleCollapsed: () => void;
}

/**
 * The sidebar's pinned Needs you section: shown by default in One list and Project grouping;
 * turned off or collapsed per device.
 */
export const useNeedsYouSectionStore = create<NeedsYouSectionState>()(
  persist<NeedsYouSectionState, [], [], Persisted>(
    (set) => ({
      enabled: true,
      collapsed: false,
      setEnabled: (enabled) => set({ enabled }),
      toggleCollapsed: () => set((state) => ({ collapsed: !state.collapsed })),
    }),
    {
      name: "sidebar-needs-you-section",
      storage: createValidatedPersistStorage(AsyncStorage, PersistedSchema),
      partialize: (state) => ({ enabled: state.enabled, collapsed: state.collapsed }),
    },
  ),
);
