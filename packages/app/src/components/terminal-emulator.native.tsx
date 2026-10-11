import { useAppSettings } from "../hooks/use-settings";
import { resolveTerminalRendererSelection } from "../terminal/native-renderer/terminal-renderer-capability";
import NativeGridTerminalEmulator from "./terminal-emulator-native-grid.native";
import WebViewTerminalEmulator from "./terminal-emulator-webview.native";
import type { TerminalEmulatorProps } from "./terminal-emulator-contract";

export type { TerminalEmulatorHandle } from "./terminal-emulator-contract";

export default function TerminalEmulator(props: TerminalEmulatorProps) {
  const { settings } = useAppSettings();
  const { useLegacyTerminalRenderer } = settings;
  const rendererSelection = resolveTerminalRendererSelection({
    useLegacyTerminalRenderer,
    supportsTerminalInputModeReplay: props.supportsTerminalInputModeReplay,
  });

  const Renderer =
    rendererSelection === "webview" ? WebViewTerminalEmulator : NativeGridTerminalEmulator;

  return <Renderer key={rendererSelection} {...props} />;
}
