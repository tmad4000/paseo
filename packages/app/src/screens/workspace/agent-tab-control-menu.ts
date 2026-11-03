import type { WorkspaceTabMenuEntry } from "@/screens/workspace/workspace-tab-menu";

/**
 * Per-agent controls for an agent tab's context menu: Restart, Interrupt, mode,
 * the host queue (show, send one now, deliver, clear), copy attach command, open
 * in a new window, archive. Pure so the entry set is unit-testable; the hook in
 * use-agent-tab-control-menu-entries.ts supplies state and actions. Every action
 * is an existing daemon RPC (see docs/agent-tab-control.md for the CLI/MCP twins).
 */
export const AGENT_TAB_QUEUE_PREVIEW_LIMIT = 5;

export interface AgentTabControlState {
  agentId: string;
  /** Agent lifecycle; Interrupt is offered only while running. */
  status: string;
  modes: ReadonlyArray<{ id: string; label: string }>;
  currentModeId: string | null;
  queue: ReadonlyArray<{ id: string; text: string }>;
  features: { restart: boolean; queueDrain: boolean; queueSendNow: boolean };
  canOpenInNewWindow: boolean;
}

export interface AgentTabControlActions {
  onRestart: (agentId: string) => void;
  onInterrupt: (agentId: string) => void;
  onSetMode: (agentId: string, modeId: string) => void;
  onSendQueuedNow: (agentId: string, itemId: string) => void;
  onDeliverQueue: (agentId: string) => void;
  onClearQueue: (agentId: string) => void;
  onCopyAttachCommand: (agentId: string) => void;
  onOpenInNewWindow: (agentId: string) => void;
  onArchive: (agentId: string) => void;
}

export interface AgentTabControlLabels {
  restartAgent: string;
  restartAgentTooltip: string;
  interruptAgent: string;
  modeItem: (mode: string) => string;
  queueHeader: (count: number) => string;
  queueSendNow: (preview: string) => string;
  queueMore: (count: number) => string;
  queueDeliver: string;
  queueClear: string;
  copyAttachCommand: string;
  openInNewWindow: string;
  archiveAgent: string;
}

function previewText(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return "…";
  return flat.length > 48 ? `${flat.slice(0, 47)}…` : flat;
}

export function buildAgentTabControlMenuEntries(input: {
  state: AgentTabControlState;
  actions: AgentTabControlActions;
  labels: AgentTabControlLabels;
  menuTestIDBase: string;
}): WorkspaceTabMenuEntry[] {
  const { state, actions, labels, menuTestIDBase: base } = input;
  const { agentId } = state;
  const entries: WorkspaceTabMenuEntry[] = [];
  const separator = (key: string) => {
    if (entries.length > 0 && entries[entries.length - 1]?.kind !== "separator") {
      entries.push({ kind: "separator", key });
    }
  };

  if (state.features.restart) {
    entries.push({
      kind: "item",
      key: "restart-agent",
      label: labels.restartAgent,
      icon: "refresh-ccw-dot",
      tooltip: labels.restartAgentTooltip,
      testID: `${base}-restart-agent`,
      onSelect: () => actions.onRestart(agentId),
    });
  }
  if (state.status === "running") {
    entries.push({
      kind: "item",
      key: "interrupt-agent",
      label: labels.interruptAgent,
      icon: "square",
      testID: `${base}-interrupt-agent`,
      onSelect: () => actions.onInterrupt(agentId),
    });
  }

  if (state.modes.length > 1) {
    separator("modes-separator");
    for (const mode of state.modes) {
      const current = mode.id === state.currentModeId;
      entries.push({
        kind: "item",
        key: `mode-${mode.id}`,
        label: labels.modeItem(mode.label),
        icon: current ? "circle-check" : "circle",
        disabled: current,
        testID: `${base}-mode-${mode.id}`,
        onSelect: () => actions.onSetMode(agentId, mode.id),
      });
    }
  }

  if (state.queue.length > 0) {
    separator("queue-separator");
    entries.push({
      kind: "item",
      key: "queue-header",
      label: labels.queueHeader(state.queue.length),
      icon: "list-ordered",
      disabled: true,
      testID: `${base}-queue-header`,
      onSelect: () => undefined,
    });
    for (const item of state.queue.slice(0, AGENT_TAB_QUEUE_PREVIEW_LIMIT)) {
      entries.push({
        kind: "item",
        key: `queue-send-now-${item.id}`,
        label: labels.queueSendNow(previewText(item.text)),
        icon: "send",
        disabled: !state.features.queueSendNow,
        testID: `${base}-queue-send-now-${item.id}`,
        onSelect: () => actions.onSendQueuedNow(agentId, item.id),
      });
    }
    const hidden = state.queue.length - AGENT_TAB_QUEUE_PREVIEW_LIMIT;
    if (hidden > 0) {
      entries.push({
        kind: "item",
        key: "queue-more",
        label: labels.queueMore(hidden),
        disabled: true,
        testID: `${base}-queue-more`,
        onSelect: () => undefined,
      });
    }
    if (state.features.queueDrain) {
      entries.push({
        kind: "item",
        key: "queue-deliver",
        label: labels.queueDeliver,
        icon: "send",
        testID: `${base}-queue-deliver`,
        onSelect: () => actions.onDeliverQueue(agentId),
      });
      entries.push({
        kind: "item",
        key: "queue-clear",
        label: labels.queueClear,
        icon: "trash-2",
        destructive: true,
        testID: `${base}-queue-clear`,
        onSelect: () => actions.onClearQueue(agentId),
      });
    }
  }

  separator("agent-controls-separator");
  entries.push({
    kind: "item",
    key: "copy-attach-command",
    label: labels.copyAttachCommand,
    icon: "copy",
    testID: `${base}-copy-attach-command`,
    onSelect: () => actions.onCopyAttachCommand(agentId),
  });
  if (state.canOpenInNewWindow) {
    entries.push({
      kind: "item",
      key: "open-in-new-window",
      label: labels.openInNewWindow,
      icon: "app-window",
      testID: `${base}-open-in-new-window`,
      onSelect: () => actions.onOpenInNewWindow(agentId),
    });
  }
  entries.push({
    kind: "item",
    key: "archive-agent",
    label: labels.archiveAgent,
    icon: "archive",
    destructive: true,
    testID: `${base}-archive-agent`,
    onSelect: () => actions.onArchive(agentId),
  });
  entries.push({ kind: "separator", key: "agent-controls-end-separator" });
  return entries;
}

/** The shell command that attaches a terminal to this agent's live stream. */
export function buildAgentAttachCommand(agentId: string): string {
  return `paseo agent attach ${agentId}`;
}
