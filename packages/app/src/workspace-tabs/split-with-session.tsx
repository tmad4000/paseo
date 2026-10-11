import { createContext, useContext } from "react";

export type SplitWithSessionPosition = "right" | "bottom";

/**
 * Lets a pane's menu split it and drop an existing session into the new half. Provided by the
 * workspace screen, which owns the picker and the layout; absent anywhere that cannot (Views keep
 * their own picker), so the menu items simply do not appear there.
 */
export interface SplitWithSessionValue {
  request: (paneId: string, position: SplitWithSessionPosition) => void;
}

export const SplitWithSessionContext = createContext<SplitWithSessionValue | null>(null);

export function useSplitWithSession(): SplitWithSessionValue | null {
  return useContext(SplitWithSessionContext);
}
