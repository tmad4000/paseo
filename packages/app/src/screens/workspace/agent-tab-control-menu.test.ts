import { describe, expect, it, vi } from "vitest";
import {
  AGENT_TAB_QUEUE_PREVIEW_LIMIT,
  buildAgentAttachCommand,
  buildAgentTabControlMenuEntries,
  type AgentTabControlActions,
  type AgentTabControlLabels,
  type AgentTabControlState,
} from "./agent-tab-control-menu";

const labels: AgentTabControlLabels = {
  restartAgent: "Restart agent",
  restartAgentTooltip: "tooltip",
  interruptAgent: "Interrupt",
  modeItem: (mode) => `Mode: ${mode}`,
  queueHeader: (count) => `Queued messages (${count})`,
  queueSendNow: (preview) => `Send now: ${preview}`,
  queueMore: (count) => `${count} more queued`,
  queueDeliver: "Deliver queue now",
  queueClear: "Clear queue",
  copyAttachCommand: "Copy attach command",
  openInNewWindow: "Open in new window",
  archiveAgent: "Archive agent",
};

function actions(): AgentTabControlActions {
  return {
    onRestart: vi.fn(),
    onInterrupt: vi.fn(),
    onSetMode: vi.fn(),
    onSendQueuedNow: vi.fn(),
    onDeliverQueue: vi.fn(),
    onClearQueue: vi.fn(),
    onCopyAttachCommand: vi.fn(),
    onOpenInNewWindow: vi.fn(),
    onArchive: vi.fn(),
  };
}

function state(overrides: Partial<AgentTabControlState> = {}): AgentTabControlState {
  return {
    agentId: "agent-1",
    status: "idle",
    modes: [],
    currentModeId: null,
    queue: [],
    features: { restart: true, queueDrain: true, queueSendNow: true },
    canOpenInNewWindow: true,
    ...overrides,
  };
}

function build(s: AgentTabControlState, a = actions()) {
  return buildAgentTabControlMenuEntries({ state: s, actions: a, labels, menuTestIDBase: "m" });
}

function items(entries: ReturnType<typeof build>) {
  return entries.flatMap((entry) => (entry.kind === "item" ? [entry] : []));
}

describe("buildAgentTabControlMenuEntries", () => {
  it("offers restart, attach, new window and archive for an idle agent", () => {
    expect(items(build(state())).map((entry) => entry.label)).toEqual([
      "Restart agent",
      "Copy attach command",
      "Open in new window",
      "Archive agent",
    ]);
  });

  it("restart calls the restart action for the tab's agent", () => {
    const a = actions();
    items(build(state(), a))
      .find((entry) => entry.key === "restart-agent")
      ?.onSelect();
    expect(a.onRestart).toHaveBeenCalledWith("agent-1");
  });

  it("hides restart on hosts without the capability and interrupt unless running", () => {
    const keys = items(
      build(state({ features: { restart: false, queueDrain: false, queueSendNow: false } })),
    ).map((entry) => entry.key);
    expect(keys).not.toContain("restart-agent");
    expect(keys).not.toContain("interrupt-agent");
    expect(items(build(state({ status: "running" }))).map((entry) => entry.key)).toContain(
      "interrupt-agent",
    );
  });

  it("lists modes with the current one checked and disabled", () => {
    const a = actions();
    const entries = items(
      build(
        state({
          modes: [
            { id: "default", label: "Default" },
            { id: "plan", label: "Plan" },
          ],
          currentModeId: "default",
        }),
        a,
      ),
    );
    const current = entries.find((entry) => entry.key === "mode-default");
    const other = entries.find((entry) => entry.key === "mode-plan");
    expect(current).toMatchObject({ icon: "circle-check", disabled: true });
    expect(other).toMatchObject({ icon: "circle", label: "Mode: Plan" });
    other?.onSelect();
    expect(a.onSetMode).toHaveBeenCalledWith("agent-1", "plan");
  });

  it("shows the queue in order with send-now, deliver and clear", () => {
    const a = actions();
    const queue = Array.from({ length: AGENT_TAB_QUEUE_PREVIEW_LIMIT + 2 }, (_, index) => ({
      id: `q${index}`,
      text: `message   ${index}\nline two`,
    }));
    const entries = items(build(state({ queue }), a));
    expect(entries.find((entry) => entry.key === "queue-header")?.label).toBe(
      `Queued messages (${queue.length})`,
    );
    const sendNow = entries.filter((entry) => entry.key.startsWith("queue-send-now-"));
    expect(sendNow.map((entry) => entry.key)).toEqual(
      queue.slice(0, AGENT_TAB_QUEUE_PREVIEW_LIMIT).map((item) => `queue-send-now-${item.id}`),
    );
    expect(sendNow[0]?.label).toBe("Send now: message 0 line two");
    expect(entries.find((entry) => entry.key === "queue-more")?.label).toBe("2 more queued");

    sendNow[1]?.onSelect();
    expect(a.onSendQueuedNow).toHaveBeenCalledWith("agent-1", "q1");
    entries.find((entry) => entry.key === "queue-deliver")?.onSelect();
    expect(a.onDeliverQueue).toHaveBeenCalledWith("agent-1");
    const clear = entries.find((entry) => entry.key === "queue-clear");
    expect(clear?.destructive).toBe(true);
    clear?.onSelect();
    expect(a.onClearQueue).toHaveBeenCalledWith("agent-1");
  });

  it("omits deliver/clear on hosts without queueDrain and disables send-now without queueSendNow", () => {
    const entries = items(
      build(
        state({
          queue: [{ id: "q", text: "x" }],
          features: { restart: true, queueDrain: false, queueSendNow: false },
        }),
      ),
    );
    expect(entries.map((entry) => entry.key)).not.toContain("queue-deliver");
    expect(entries.map((entry) => entry.key)).not.toContain("queue-clear");
    expect(entries.find((entry) => entry.key === "queue-send-now-q")?.disabled).toBe(true);
  });

  it("never emits two separators in a row", () => {
    const entries = build(state({ queue: [{ id: "q", text: "x" }], status: "running" }));
    entries.forEach((entry, index) => {
      if (entry.kind === "separator") expect(entries[index - 1]?.kind).not.toBe("separator");
    });
  });

  it("omits open in new window outside the desktop app", () => {
    expect(
      items(build(state({ canOpenInNewWindow: false }))).map((entry) => entry.key),
    ).not.toContain("open-in-new-window");
  });
});

describe("buildAgentAttachCommand", () => {
  it("attaches with the paseo CLI", () => {
    expect(buildAgentAttachCommand("abc")).toBe("paseo agent attach abc");
  });
});
