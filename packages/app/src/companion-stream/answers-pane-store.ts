import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

/**
 * Whether the floating Questions and asks pane sits minimized to its pill, shared by every chat
 * and remembered across launches. `null` means the person has not chosen yet, so the pane follows
 * its form-factor default: minimized on phones, open on wider screens.
 */
interface AnswersPaneState {
  minimized: boolean | null;
  setMinimized: (minimized: boolean) => void;
}

const PersistedAnswersPaneSchema = z.object({ minimized: z.boolean().nullable() });

export const useAnswersPaneStore = create<AnswersPaneState>()(
  persist<AnswersPaneState, [], [], z.infer<typeof PersistedAnswersPaneSchema>>(
    (set) => ({
      minimized: null,
      setMinimized: (minimized) => set({ minimized }),
    }),
    {
      name: "answers-pane",
      storage: createValidatedPersistStorage(AsyncStorage, PersistedAnswersPaneSchema),
      partialize: (state) => ({ minimized: state.minimized }),
    },
  ),
);
