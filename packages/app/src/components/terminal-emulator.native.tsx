import { useEffect } from "react";
import { View } from "react-native";
import { useAppSettings } from "../hooks/use-settings";
import { resolveTerminalRendererSelection } from "../terminal/native-renderer/terminal-renderer-capability";
import NativeGridTerminalEmulator from "./terminal-emulator-native-grid.native";
import WebViewTerminalEmulator from "./terminal-emulator-webview.native";
import type { TerminalEmulatorProps } from "./terminal-emulator-contract";

export type { TerminalEmulatorHandle } from "./terminal-emulator-contract";

const PENDING_STYLE = { flex: 1 } as const;

function PendingTerminal({ streamKey, onRendererReadyChange }: TerminalEmulatorProps) {
  useEffect(() => {
    onRendererReadyChange?.({ streamKey, isReady: false });
  }, [onRendererReadyChange, streamKey]);

  return <View style={PENDING_STYLE} />;
}

export default function TerminalEmulator(props: TerminalEmulatorProps) {
  const { settings } = useAppSettings();
  const { useLegacyTerminalRenderer } = settings;
  const rendererSelection = resolveTerminalRendererSelection({
    useLegacyTerminalRenderer,
    supportsTerminalInputModeReplay: props.supportsTerminalInputModeReplay,
  });

  if (rendererSelection === "pending") {
    return <PendingTerminal {...props} />;
  }

  const Renderer =
    rendererSelection === "webview" ? WebViewTerminalEmulator : NativeGridTerminalEmulator;

  return <Renderer key={rendererSelection} {...props} />;
}
