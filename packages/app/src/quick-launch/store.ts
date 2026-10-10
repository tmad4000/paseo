import { create } from "zustand";
import { isWeb } from "@/constants/platform";
import type { QuickLaunchWorkspaceRef } from "./destination";

/** Where the dialog opens pointed. Omitted: the default destination. */
export type QuickLaunchDestination =
  | { kind: "project"; serverId: string; projectViewKey: string }
  | ({ kind: "workspace" } & QuickLaunchWorkspaceRef);

export interface QuickLaunchRequest {
  /** Goes into the Quick launch draft, above any unsent text already there. */
  prompt?: string;
  /** A workspace opens on "New tab in <workspace>"; a project on "New workspace" in it. */
  destination?: QuickLaunchDestination;
  /** Makes Start and open the primary action. The user still confirms in the dialog. */
  startAndOpen?: boolean;
}

export interface QuickLaunchOpenInput extends QuickLaunchRequest {
  /** Focus target after closing. Defaults to whatever is focused when the dialog opens. */
  restoreFocusTo?: HTMLElement | null;
}

export interface QuickLaunchSession {
  id: number;
  request: QuickLaunchRequest;
}

interface QuickLaunchState {
  session: QuickLaunchSession | null;
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

export const useQuickLaunchStore = create<QuickLaunchState>((set) => ({
  session: null,
  close: () => set({ session: null }),
}));

function hasRequestContent(request: QuickLaunchRequest): boolean {
  return (
    request.prompt !== undefined ||
    request.destination !== undefined ||
    request.startAndOpen !== undefined
  );
}

/**
 * Opens Quick launch. Every entry point (the shortcut, the command center, the sidebar item, and
 * callers such as the sidebar router's Start without leaving) goes through here, so all of them
 * share the dialog's single creation path.
 *
 * Reopening with nothing new keeps an open dialog and its unsent choices; a prompt, destination,
 * or start-and-open request replaces it.
 */
export function openQuickLaunch(input: QuickLaunchOpenInput = {}): void {
  const { restoreFocusTo, ...request } = input;
  const current = useQuickLaunchStore.getState().session;
  if (current && !hasRequestContent(request)) return;
  if (!current) {
    focusRestoreElement = restoreFocusTo !== undefined ? restoreFocusTo : readFocusedElement();
  }
  useQuickLaunchStore.setState({ session: { id: nextSessionId++, request } });
}
