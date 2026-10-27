import AsyncStorage from "@react-native-async-storage/async-storage";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import { create } from "zustand";

type AgentView = "chat" | "artifacts";
const AgentViewsSchema = z.object({
  selectedViews: z.record(z.string(), z.enum(["chat", "artifacts"])),
});

interface AgentViewStoreState {
  selectedViews: Record<string, AgentView>;
  /** Find is an overlay on Chat, not a sibling view, so it is tracked separately. */
  findOpen: Record<string, boolean>;
  setSelectedView: (serverId: string, agentId: string, view: AgentView) => void;
  getSelectedView: (serverId: string, agentId: string) => AgentView;
  setFindOpen: (serverId: string, agentId: string, open: boolean) => void;
}

export const useAgentViewStore = create<AgentViewStoreState>()(
  persist(
    (set, get) => ({
      selectedViews: {},
      findOpen: {},
      setSelectedView: (serverId, agentId, view) => {
        set((state) => ({
          selectedViews: {
            ...state.selectedViews,
            [`${serverId}:${agentId}`]: view,
          },
        }));
      },
      getSelectedView: (serverId, agentId) => {
        return get().selectedViews[`${serverId}:${agentId}`] || "chat";
      },
      setFindOpen: (serverId, agentId, open) => {
        set((state) => ({
          findOpen: {
            ...state.findOpen,
            [`${serverId}:${agentId}`]: open,
          },
        }));
      },
    }),
    {
      name: "agent-selected-views",
      storage: createValidatedPersistStorage(AsyncStorage, AgentViewsSchema),
      partialize: (state) => ({ selectedViews: state.selectedViews }),
      merge: (persisted, current) => {
        const saved = AgentViewsSchema.safeParse(persisted);
        if (!saved.success) return current;
        // A fresh deep link wins over a slower AsyncStorage hydration result.
        return {
          ...current,
          selectedViews: { ...saved.data.selectedViews, ...current.selectedViews },
        };
      },
    },
  ),
);
