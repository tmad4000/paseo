import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";
import { create } from "zustand";
import { persist, type StateStorage } from "zustand/middleware";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

interface AnswersPaneState {
  /** The old global choice seeds panes that have no explicit choice yet. */
  minimized: boolean | null;
  minimizedByPane: Record<string, boolean>;
  setMinimized: (paneKey: string, minimized: boolean) => void;
}

const PersistedAnswersPaneSchema = z.object({
  minimized: z.boolean().nullable(),
  minimizedByPane: z.record(z.string(), z.boolean()).default({}),
});

/** Stable across remounts, unique even for the same chat shown in different splits. */
export function answersPaneKey(
  serverId: string,
  workspaceId: string | null,
  tabId: string | null,
  agentId: string,
): string {
  return JSON.stringify([serverId, workspaceId, tabId, agentId]);
}

/** Storage is injectable so persistence and legacy restore can be tested without mocks. */
export function createAnswersPaneStore(storage: StateStorage) {
  return create<AnswersPaneState>()(
    persist<AnswersPaneState, [], [], z.infer<typeof PersistedAnswersPaneSchema>>(
      (set) => ({
        minimized: null,
        minimizedByPane: {},
        setMinimized: (paneKey, minimized) =>
          set((state) => ({
            minimizedByPane: { ...state.minimizedByPane, [paneKey]: minimized },
          })),
      }),
      {
        name: "answers-pane",
        storage: createValidatedPersistStorage(storage, PersistedAnswersPaneSchema),
        partialize: (state) => ({
          minimized: state.minimized,
          minimizedByPane: state.minimizedByPane,
        }),
      },
    ),
  );
}

export const useAnswersPaneStore = createAnswersPaneStore(AsyncStorage);
