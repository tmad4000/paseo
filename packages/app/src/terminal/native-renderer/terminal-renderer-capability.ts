export type TerminalRendererSelection = "native-grid" | "webview" | "pending";

export function resolveTerminalRendererSelection(input: {
  useLegacyTerminalRenderer: boolean;
  /** Null while the host's server info has not arrived. */
  supportsTerminalInputModeReplay: boolean | null;
}): TerminalRendererSelection {
  if (input.useLegacyTerminalRenderer) {
    return "webview";
  }
  // Waiting for server info avoids attaching one renderer and remounting into the other.
  if (input.supportsTerminalInputModeReplay === null) {
    return "pending";
  }
  // COMPAT(terminalInputModeReplay): the native grid needs input mode replay (v0.2.6). An older
  // host keeps the WebView renderer it always had instead of losing the terminal; remove after
  // 2027-02-02 with the feature gate.
  return input.supportsTerminalInputModeReplay ? "native-grid" : "webview";
}
