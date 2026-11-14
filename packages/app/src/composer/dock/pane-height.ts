import { createContext, useContext } from "react";

// The dock owns this measurement so a growing draft cannot change its own limit.
// Native docks retain their keyboard-aware capacity policy and the default null.
export const ComposerPaneHeightContext = createContext<number | null>(null);
export const useComposerPaneHeight = () => useContext(ComposerPaneHeightContext);
