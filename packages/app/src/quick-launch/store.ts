import { create } from "zustand";
import { isWeb } from "@/constants/platform";
import type {
  QuickLaunchProjectChoice,
  QuickLaunchWhere,
  QuickLaunchWorkspaceRef,
} from "./destination";

export interface QuickLaunchPrefill {
  /** Replaces the Quick launch draft. */
  text?: string;
  /** Offered as the "New tab in" destination instead of the active workspace. */
  workspace?: QuickLaunchWorkspaceRef;
  project?: QuickLaunchProjectChoice;
  where?: QuickLaunchWhere;
}

export interface QuickLaunchSession {
  id: number;
  prefill: QuickLaunchPrefill | null;
}

interface QuickLaunchState {
  session: QuickLaunchSession | null;
  open: (input?: { prefill?: QuickLaunchPrefill; restoreFocusTo?: HTMLElement | null }) => void;
  close: () => void;
}

// Not state: nothing renders from it. Closing hands focus back to whatever had it before the
// dialog opened, usually the current chat's composer.
let focusRestoreElement: HTMLElement | null = null;
let nextSessionId = 1;

function readFocusedElement(): HTMLElement | null {
  if (!isWeb || typeof document === "undefined") return null;
  const active = document.activeElement;
  return active instanceof HTMLElement ? active : null;
}

export function takeQuickLaunchFocusRestoreElement(): HTMLElement | null {
  const element = focusRestoreElement;
  focusRestoreElement = null;
  return element;
}

export const useQuickLaunchStore = create<QuickLaunchState>((set, get) => ({
  session: null,
  open: (input) => {
    const current = get().session;
    // Reopening without new content keeps the open dialog and its unsent choices.
    if (current && !input?.prefill) return;
    if (!current) {
      focusRestoreElement =
        input?.restoreFocusTo !== undefined ? input.restoreFocusTo : readFocusedElement();
    }
    set({ session: { id: nextSessionId++, prefill: input?.prefill ?? null } });
  },
  close: () => set({ session: null }),
}));
