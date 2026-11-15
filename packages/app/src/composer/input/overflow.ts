import type { SendBehavior } from "@/composer/input/state";

/**
 * A toolbar action that lives in the composer's "More actions" menu instead of its own button.
 * The compact toolbar has no room for a button per action, and some actions (queueing while the
 * agent runs) have no button at any width, only a shortcut a touch screen cannot press.
 */
export interface ComposerOverflowItem {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}

export type AlternateSendLabelKey =
  | "composer.input.queueMessage"
  | "composer.input.sendAndInterrupt";

/**
 * The send the button does not do. Enter/the send button run the default send behavior; this is
 * the other one, which on a keyboard is Command/Ctrl+Enter. It only differs from the default while
 * the agent is running and the host can queue.
 */
export function resolveAlternateSendOverflow(input: {
  enabled: boolean;
  isAgentRunning: boolean;
  canQueue: boolean;
  defaultSendBehavior: SendBehavior;
  hasSendableContent: boolean;
  isSendDisabled: boolean;
}): { labelKey: AlternateSendLabelKey; disabled: boolean } | null {
  if (!input.enabled || !input.isAgentRunning || !input.canQueue) return null;
  return {
    labelKey:
      input.defaultSendBehavior === "queue"
        ? "composer.input.sendAndInterrupt"
        : "composer.input.queueMessage",
    // Kept in the menu while the draft is empty so the trigger doesn't appear mid-typing.
    disabled: !input.hasSendableContent || input.isSendDisabled,
  };
}

export type VoiceModeButtonPlacement = "toolbar" | "overflow" | "hidden";

/**
 * Voice mode sits in the toolbar until a compact composer has a draft; from then on the draft's
 * send button needs the room, so voice mode moves into the overflow menu instead of vanishing.
 */
export function resolveVoiceModeButtonPlacement(input: {
  showVoice: boolean;
  isVoiceModeForAgent: boolean;
  hasAgent: boolean;
  isAgentRunning: boolean;
  isCompact: boolean;
  hasSendableContent: boolean;
}): VoiceModeButtonPlacement {
  if (!input.showVoice || input.isVoiceModeForAgent || !input.hasAgent || input.isAgentRunning) {
    return "hidden";
  }
  if (input.isCompact && input.hasSendableContent) return "overflow";
  return "toolbar";
}
