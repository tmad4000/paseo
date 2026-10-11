import { describe, expect, it } from "vitest";

import { resolveTerminalRendererSelection } from "./terminal-renderer-capability";

describe("terminal renderer capability", () => {
  it("keeps an older daemon's terminal on the WebView renderer instead of blocking it", () => {
    expect(
      resolveTerminalRendererSelection({
        useLegacyTerminalRenderer: false,
        supportsTerminalInputModeReplay: false,
      }),
    ).toBe("webview");
  });

  it("allows the native renderer when the daemon advertises input mode replay", () => {
    expect(
      resolveTerminalRendererSelection({
        useLegacyTerminalRenderer: false,
        supportsTerminalInputModeReplay: true,
      }),
    ).toBe("native-grid");
  });

  it("keeps the explicit legacy renderer available with older daemons", () => {
    expect(
      resolveTerminalRendererSelection({
        useLegacyTerminalRenderer: true,
        supportsTerminalInputModeReplay: false,
      }),
    ).toBe("webview");
  });

  it("waits for the host's server info before attaching either renderer", () => {
    expect(
      resolveTerminalRendererSelection({
        useLegacyTerminalRenderer: false,
        supportsTerminalInputModeReplay: null,
      }),
    ).toBe("pending");
  });
});
