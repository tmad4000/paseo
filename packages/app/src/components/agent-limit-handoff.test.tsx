/** @vitest-environment jsdom */
import React, { type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompanionEntry } from "@getpaseo/protocol/companion-stream";
import { AgentLimitHandoff } from "./agent-limit-handoff";

const state = vi.hoisted(() => ({
  connected: true,
  supported: true,
  snapshotSupported: true,
  fork: vi.fn(),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/i18n/i18next", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("react-native-unistyles", () => ({ StyleSheet: { create: () => ({}) } }));
vi.mock("@/hooks/use-fork-agent", () => ({ useForkAgent: () => state.fork }));
vi.mock("@/runtime/host-features", () => ({ useHostFeature: () => state.supported }));
vi.mock("@/runtime/host-runtime", () => ({ useHostRuntimeIsConnected: () => state.connected }));
vi.mock("@/panels/pane-context", () => ({
  usePaneContext: () => ({ layoutWorkspaceId: "layout" }),
}));
vi.mock("@/constants/layout", () => ({ MAX_CONTENT_WIDTH: 800 }));
vi.mock("@/hooks/use-providers-snapshot", () => ({
  useProvidersSnapshot: () => ({
    supportsSnapshot: state.snapshotSupported,
    isLoading: false,
    error: null,
    refetchIfStale: vi.fn(),
    entries: ["claude", "codex"].map((provider) => ({
      provider,
      enabled: true,
      status: "ready",
      models: [{ id: "chosen", label: "Chosen" }],
    })),
  }),
}));
// Keep the primitive boundary small; exercise the real callout's selection,
// liveness and pending state rather than testing the shared controls again.
vi.mock("@/components/ui/alert", () => ({
  Alert: ({
    title,
    description,
    children,
  }: {
    title: string;
    description: string;
    children: ReactNode;
  }) => (
    <section role="alert">
      <h2>{title}</h2>
      <p>{description}</p>
      {children}
    </section>
  ),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    disabled,
    onPress,
  }: {
    children: ReactNode;
    disabled: boolean;
    onPress: () => void;
  }) => (
    <button type="button" disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/combined-model-selector", () => ({
  CombinedModelSelector: ({
    providers,
    onSelect,
    disabled,
  }: {
    providers: { id: string }[];
    onSelect: (provider: string, model: string) => void;
    disabled: boolean;
  }) =>
    React.createElement(
      "div",
      null,
      providers.map((provider) =>
        React.createElement(
          "button",
          {
            type: "button",
            key: provider.id,
            disabled,
            onClick: () => onSelect(provider.id, "chosen"),
          },
          `Choose ${provider.id}`,
        ),
      ),
    ),
}));

const entries: CompanionEntry[] = [
  {
    id: "limit",
    kind: "outcome",
    text: "You've hit your weekly limit · resets Nov 12 at 4am",
    timestamp: "2026-11-09T21:28:33Z",
    truncated: false,
    status: "completed",
  },
];
function Callout({
  status = "idle",
  history = entries,
}: {
  status?: "idle" | "running";
  history?: CompanionEntry[];
}) {
  return React.createElement(AgentLimitHandoff, {
    serverId: "host",
    workspaceId: "workspace",
    agentId: "source",
    agent: { id: "source", serverId: "host", provider: "claude", status, cwd: "/project" },
    entries: history,
    toast: { error: vi.fn(), show: vi.fn(), copied: vi.fn() },
  });
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  state.connected = true;
  state.supported = true;
  state.snapshotSupported = true;
  state.fork.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("provider limit handoff controls", () => {
  it("requires an explicit different-provider choice and prevents duplicate preparation", async () => {
    let finish!: () => void;
    state.fork.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    render(<Callout />);
    expect(screen.queryByRole("button", { name: "Choose claude" })).toBeNull();
    expect(screen.getByText(entries[0].text)).toBeTruthy();
    const prepare = screen.getByRole<HTMLButtonElement>("button", {
      name: "agentPanel.limitHandoff.prepare",
    });
    expect(prepare.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Choose codex" }));
    expect(prepare.disabled).toBe(false);
    fireEvent.click(prepare);
    fireEvent.click(prepare);
    expect(state.fork).toHaveBeenCalledTimes(1);
    expect(state.fork).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "source",
        workspaceId: "workspace",
        layoutWorkspaceId: "layout",
        target: "split",
        handoff: { provider: "codex", modelId: "chosen" },
      }),
    );
    finish();
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "agentPanel.limitHandoff.prepare" })
          .disabled,
      ).toBe(false),
    );
  });

  it("disables preparation while disconnected", () => {
    state.connected = false;
    render(<Callout />);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Choose codex" }).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "agentPanel.limitHandoff.prepare" }));
    expect(state.fork).not.toHaveBeenCalled();
  });

  it("uses the existing host upgrade gate", () => {
    state.supported = false;
    render(<Callout />);
    expect(screen.getByText("message.actions.forkUnavailable")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("requires a host model catalog instead of misreporting an older host as having no providers", () => {
    state.snapshotSupported = false;
    render(<Callout />);
    expect(screen.getByText("message.actions.forkUnavailable")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText("agentPanel.limitHandoff.noAlternatives")).toBeNull();
  });

  it("removes the notice during execution and after a successful outcome", () => {
    const view = render(<Callout />);
    expect(screen.getByRole("alert")).toBeTruthy();
    view.rerender(<Callout status="running" />);
    expect(screen.queryByRole("alert")).toBeNull();
    view.rerender(
      <Callout
        history={[
          ...entries,
          { ...entries[0], id: "new", timestamp: "2026-11-09T22:00:00Z", text: "Finished" },
        ]}
      />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
