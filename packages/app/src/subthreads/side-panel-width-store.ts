import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

export const SIDE_PANEL_MIN_WIDTH = 320;
export const SIDE_PANEL_MAX_WIDTH = 720;
export const SIDE_PANEL_DEFAULT_WIDTH = 440;
/** The parent chat keeps at least this much room beside the panel. */
export const SIDE_PANEL_MIN_PARENT_WIDTH = 400;

export function clampSidePanelWidth(requested: number, containerWidth: number): number {
  const maximum = Math.max(
    SIDE_PANEL_MIN_WIDTH,
    Math.min(SIDE_PANEL_MAX_WIDTH, containerWidth - SIDE_PANEL_MIN_PARENT_WIDTH),
  );
  return Math.round(Math.min(Math.max(SIDE_PANEL_MIN_WIDTH, requested), maximum));
}

const SidePanelWidthSchema = z.strictObject({ width: z.number() });

interface SidePanelWidthState {
  /** One app-wide width, like the tree rail's: dragging it in one session sets it for all. */
  width: number;
  setWidth(width: number): void;
}

export const useSidePanelWidthStore = create<SidePanelWidthState>()(
  persist(
    (set) => ({
      width: SIDE_PANEL_DEFAULT_WIDTH,
      setWidth: (width) =>
        set({ width: Math.min(SIDE_PANEL_MAX_WIDTH, Math.max(SIDE_PANEL_MIN_WIDTH, width)) }),
    }),
    {
      name: "paseo:session-side-panel-width",
      version: 1,
      storage: createValidatedPersistStorage(AsyncStorage, SidePanelWidthSchema),
      partialize: (state) => ({ width: state.width }),
    },
  ),
);
