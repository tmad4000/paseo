/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/resources/en";

// Native styling and live microphone telemetry are outside this rendered UI test.
vi.mock("react-native-unistyles", async () => {
  const { darkTheme } = await import("@/styles/theme");
  return {
    StyleSheet: { create: (factory: (theme: typeof darkTheme) => unknown) => factory(darkTheme) },
    withUnistyles: (component: unknown) => component,
  };
});
vi.mock("@/contexts/voice-context", () => ({
  useVoiceTelemetry: () => ({ volume: 0, isSpeaking: false }),
}));
vi.mock("./volume-meter", () => ({ VolumeMeter: () => null }));
vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
import { RealtimeVoiceOverlay } from "./realtime-voice-overlay";

describe("voice microphone controls", () => {
  let root: Root;
  let container: HTMLDivElement;
  const i18n = createInstance();
  const onToggleMute = vi.fn();
  const onStop = vi.fn();
  const onCancelAgent = vi.fn();
  const baseProps = {
    isMuted: true,
    isSwitching: false,
    voiceCommandsEnabled: true,
    isMuteSwitching: false,
    muteError: null,
    failure: null,
    onToggleMute,
    onStop,
  };

  async function render(
    overrides: Partial<React.ComponentProps<typeof RealtimeVoiceOverlay>> = {},
  ) {
    await act(async () => {
      root.render(
        <I18nextProvider i18n={i18n}>
          <RealtimeVoiceOverlay {...baseProps} {...overrides} />
        </I18nextProvider>,
      );
    });
  }

  beforeEach(async () => {
    await i18n.init({ lng: "en", resources: { en: { translation: en } } });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.clearAllMocks();
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("shows the persistent mute state and explains how verbal unmute still works", async () => {
    await render();
    expect(container.textContent).toContain("Microphone muted to agent");
    expect(container.textContent).toContain("Listening on your host only for “unmute microphone”");
    expect(container.textContent).toContain("Other speech is discarded");
    const unmute = container.querySelector<HTMLElement>('[aria-label="Unmute realtime voice"]')!;
    await act(async () => unmute.click());
    expect(onToggleMute).toHaveBeenCalledOnce();
    await render({ isMuted: false });
    expect(container.textContent).toContain("Microphone on");
    expect(container.textContent).toContain("Say “mute microphone” on its own");
  });

  it("shows a failed acknowledgement and keeps stop voice available", async () => {
    await render({ muteError: "Microphone paused. Stop and restart voice to reconnect." });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Microphone paused. Stop and restart voice to reconnect.",
    );
    const stop = container.querySelector<HTMLElement>('[aria-label="Stop realtime voice"]')!;
    await act(async () => stop.click());
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("says it is not listening and why when input stops reaching the agent", async () => {
    await render({ isMuted: false, failure: "host-disconnected" });
    expect(container.textContent).toContain("Not listening");
    expect(container.textContent).not.toContain("Microphone on");
    // Instructions for a working microphone would contradict the failure.
    expect(container.textContent).not.toContain("Say “mute microphone”");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Host disconnected. Microphone input is paused until it reconnects.",
    );
    await render({ isMuted: true, failure: "recognition-stalled" });
    expect(container.textContent).toContain("Not listening");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Speech recognition stopped responding. Stop and restart voice.",
    );
  });

  it("keeps listening status for a single missed utterance", async () => {
    await render({ isMuted: false, failure: "nothing-recognized" });
    expect(container.textContent).toContain("Microphone on");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Didn't catch that. Say it again.",
    );
  });

  it("prevents duplicate tap requests while a mute change is pending", async () => {
    await render({ isMuteSwitching: true });
    const unmute = container.querySelector<HTMLElement>('[aria-label="Unmute realtime voice"]')!;
    expect(unmute.getAttribute("aria-disabled")).toBe("true");
    await act(async () => unmute.click());
    expect(onToggleMute).not.toHaveBeenCalled();
  });

  it("shows delivery status and keeps Interrupt agent separate from Stop voice", async () => {
    await render({
      isMuted: false,
      lastInputStatus: "queued",
      isAgentRunning: true,
      onCancelAgent,
    });
    expect(container.textContent).toContain("Speech queued for agent");
    const interrupt = container.querySelector<HTMLElement>('[aria-label="Interrupt agent"]')!;
    const stop = container.querySelector<HTMLElement>('[aria-label="Stop realtime voice"]')!;
    await act(async () => stop.click());
    expect(onStop).toHaveBeenCalledOnce();
    expect(onCancelAgent).not.toHaveBeenCalled();
    await act(async () => interrupt.click());
    expect(onCancelAgent).toHaveBeenCalledOnce();
    await render({ isMuted: false, lastInputStatus: "sent", isAgentRunning: true, onCancelAgent });
    expect(container.textContent).toContain("Speech sent to agent");
  });
});
