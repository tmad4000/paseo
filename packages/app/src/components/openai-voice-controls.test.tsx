/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RealtimeVoiceState } from "@getpaseo/protocol/messages";
vi.mock("react-native-unistyles", async () => {
  const { darkTheme } = await import("@/styles/theme");
  return {
    StyleSheet: { create: (factory: (theme: typeof darkTheme) => unknown) => factory(darkTheme) },
    withUnistyles: (component: unknown) => component,
  };
});
const mocks = vi.hoisted(() => ({
  voice: {
    isVoiceMode: true,
    isVoiceModeForAgent: () => true,
    realtime: undefined as RealtimeVoiceState | undefined,
    isMuted: true,
    isVoiceSwitching: false,
    muteError: null,
    toggleMute: vi.fn(),
    stopVoice: vi.fn().mockResolvedValue(undefined),
    startVoice: vi.fn().mockResolvedValue(undefined),
    controlRealtime: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("@/contexts/voice-context", () => ({ useVoiceOptional: () => mocks.voice }));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: () => ({
    serverInfo: { features: { openaiRealtimeVoice: true } },
    agents: new Map([["agent", { title: "Existing coding agent" }]]),
  }),
}));
vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
import { OpenAiVoiceControls } from "./openai-voice-controls";
let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.voice.realtime = {
    provider: "openai-realtime",
    destination: "assistant",
    connection: "connected",
    mode: "listen",
    epoch: "epoch",
    draft: "Unsent draft",
    muted: true,
    error: null,
    omittedContextEntries: 0,
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root.render(<OpenAiVoiceControls serverId="host" agentId="agent" readOnly={false} />),
  );
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
function button(label: string) {
  return Array.from(container.querySelectorAll<HTMLElement>('[role="button"],button')).find(
    (element) => element.textContent === label,
  )!;
}
it("shows mic-off privacy, saved draft and explicit target with separate voice controls", async () => {
  expect(container.textContent).toContain("voice unmute is unavailable");
  expect(container.textContent).toContain("Existing coding agent");
  expect(container.textContent).toContain("Unsent draft");
  await act(async () => button("End listening").click());
  expect(mocks.voice.controlRealtime).toHaveBeenCalledExactlyOnceWith("end_listening");
  expect(mocks.voice.stopVoice).not.toHaveBeenCalled();
});
it("ends the cloud attachment before explicitly selecting muted Paseo fallback", async () => {
  await act(async () => button("Use Paseo voice, muted").click());
  expect(mocks.voice.stopVoice).toHaveBeenCalledOnce();
  expect(mocks.voice.startVoice).toHaveBeenCalledExactlyOnceWith("host", "agent", "paseo", true);
  expect(mocks.voice.stopVoice.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.voice.startVoice.mock.invocationCallOrder[0],
  );
});
