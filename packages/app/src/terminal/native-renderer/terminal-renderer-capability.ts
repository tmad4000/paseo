export type TerminalRendererSelection = "native-grid" | "webview";

export function resolveTerminalRendererSelection(input: {
  useLegacyTerminalRenderer: boolean;
  supportsTerminalInputModeReplay: boolean;
}): TerminalRendererSelection {
  if (input.useLegacyTerminalRenderer) {
    return "webview";
  }
  // COMPAT(terminalInputModeReplay): the native grid needs input mode replay (v0.2.6). An older
  // host keeps the WebView renderer it always had instead of losing the terminal; remove after
  // 2027-02-02 with the feature gate.
  return input.supportsTerminalInputModeReplay ? "native-grid" : "webview";
}
