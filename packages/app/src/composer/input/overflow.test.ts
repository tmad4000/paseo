import { describe, expect, it } from "vitest";
import { resolveAlternateSendOverflow, resolveVoiceModeButtonPlacement } from "./overflow";

const running = {
  enabled: true,
  isAgentRunning: true,
  canQueue: true,
  defaultSendBehavior: "interrupt" as const,
  hasSendableContent: true,
  isSendDisabled: false,
};

describe("resolveAlternateSendOverflow", () => {
  it("offers Queue message when the default send interrupts or steers", () => {
    expect(resolveAlternateSendOverflow(running)).toEqual({
      labelKey: "composer.input.queueMessage",
      disabled: false,
    });
    expect(resolveAlternateSendOverflow({ ...running, defaultSendBehavior: "steer" })).toEqual({
      labelKey: "composer.input.queueMessage",
      disabled: false,
    });
  });

  it("offers Send and interrupt when the default send queues", () => {
    expect(resolveAlternateSendOverflow({ ...running, defaultSendBehavior: "queue" })).toEqual({
      labelKey: "composer.input.sendAndInterrupt",
      disabled: false,
    });
  });

  it("stays in the menu but disabled while there is nothing to send", () => {
    expect(resolveAlternateSendOverflow({ ...running, hasSendableContent: false })).toEqual({
      labelKey: "composer.input.queueMessage",
      disabled: true,
    });
    expect(resolveAlternateSendOverflow({ ...running, isSendDisabled: true })?.disabled).toBe(true);
  });

  it("is absent on a wide toolbar, an idle agent, or a host that cannot queue", () => {
    expect(resolveAlternateSendOverflow({ ...running, enabled: false })).toBeNull();
    expect(resolveAlternateSendOverflow({ ...running, isAgentRunning: false })).toBeNull();
    expect(resolveAlternateSendOverflow({ ...running, canQueue: false })).toBeNull();
  });
});

describe("resolveVoiceModeButtonPlacement", () => {
  const idle = {
    showVoice: true,
    isVoiceModeForAgent: false,
    hasAgent: true,
    isAgentRunning: false,
    isCompact: true,
    hasSendableContent: false,
  };

  it("keeps voice mode in the toolbar until a compact composer has a draft", () => {
    expect(resolveVoiceModeButtonPlacement(idle)).toBe("toolbar");
    expect(resolveVoiceModeButtonPlacement({ ...idle, hasSendableContent: true })).toBe("overflow");
  });

  it("never moves voice mode on a wide toolbar", () => {
    expect(
      resolveVoiceModeButtonPlacement({ ...idle, isCompact: false, hasSendableContent: true }),
    ).toBe("toolbar");
  });

  it("hides voice mode where it cannot start", () => {
    expect(resolveVoiceModeButtonPlacement({ ...idle, isAgentRunning: true })).toBe("hidden");
    expect(resolveVoiceModeButtonPlacement({ ...idle, isVoiceModeForAgent: true })).toBe("hidden");
    expect(resolveVoiceModeButtonPlacement({ ...idle, hasAgent: false })).toBe("hidden");
    expect(resolveVoiceModeButtonPlacement({ ...idle, showVoice: false })).toBe("hidden");
  });
});
