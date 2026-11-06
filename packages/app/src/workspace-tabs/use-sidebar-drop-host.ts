import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/contexts/toast-context";
import { useStableEvent } from "@/hooks/use-stable-event";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import type { WorkspaceTab } from "@/workspace-tabs/model";
import {
  planSidebarSessionDrop,
  registerSidebarDropHost,
  resolveLastActiveWorkspaceAgent,
  type SidebarDragPayload,
  type SidebarDropOutcome,
  type SidebarDropPlan,
  type SidebarDropTarget,
} from "./sidebar-session-drop";

interface DroppedSession {
  agentId: string;
  homeWorkspaceId: string | null;
}

/** The session a payload stands for; a workspace row stands for its last active session. */
function resolveDroppedSession(
  serverId: string,
  payload: SidebarDragPayload,
): DroppedSession | null {
  const session = useSessionStore.getState().sessions[serverId];
  if (payload.kind === "agent") {
    const agent =
      session?.agents.get(payload.agentId) ?? session?.agentDetails.get(payload.agentId);
    return {
      agentId: payload.agentId,
      homeWorkspaceId: agent?.workspaceId ?? payload.workspaceId ?? null,
    };
  }
  const agent = resolveLastActiveWorkspaceAgent(
    session?.agents.values() ?? [],
    payload.workspaceId,
  );
  return agent ? { agentId: agent.id, homeWorkspaceId: payload.workspaceId } : null;
}

/** Runs a plan with the same layout actions the split picker and the tab drag use. */
function applySidebarDropPlan(
  workspaceKey: string,
  agentId: string,
  plan: SidebarDropPlan,
): string | null {
  const layout = useWorkspaceLayoutStore.getState();
  const openInPane = (paneId: string, pin: boolean) =>
    layout.openTab({
      workspaceKey,
      target: { kind: "agent", agentId },
      intent: "reveal",
      placement: { mode: "pane", paneId },
      pin,
    });
  switch (plan.kind) {
    case "move-tab":
      layout.moveTabToPane(workspaceKey, plan.tabId, plan.paneId);
      return plan.tabId;
    case "split-with-tab":
      layout.splitPane(workspaceKey, {
        tabId: plan.tabId,
        targetPaneId: plan.paneId,
        position: plan.position,
      });
      return plan.tabId;
    case "open-tab":
      return openInPane(plan.paneId, plan.pin);
    case "split-and-open": {
      const newPaneId = layout.splitPaneEmpty(workspaceKey, {
        targetPaneId: plan.paneId,
        position: plan.position,
      });
      return openInPane(newPaneId ?? plan.paneId, plan.pin);
    }
  }
}

/**
 * Registers the focused workspace as the place sidebar rows drop into. A drop does what "Split
 * right / down with session…" does: the same split and tab actions, and a session from another
 * workspace on this host is pinned so reconciliation keeps it and closing it never archives it.
 */
export function useSidebarDropHost(input: {
  routeFocused: boolean;
  rendersSplits: boolean;
  serverId: string;
  workspaceId: string;
  workspaceKey: string | null;
  uiTabs: readonly WorkspaceTab[];
  navigateToTabId: (tabId: string) => void;
}): void {
  const { serverId, workspaceKey } = input;
  const enabled = input.routeFocused && input.rendersSplits && Boolean(workspaceKey);
  const { t } = useTranslation();
  const toast = useToast();

  const drop = useStableEvent(
    (payload: SidebarDragPayload, target: SidebarDropTarget): SidebarDropOutcome => {
      if (!workspaceKey || target.workspaceKey !== workspaceKey) return "ignored";
      if (payload.serverId !== serverId) {
        toast.error(t("workspace.tabs.actions.dropSessionOtherHost"));
        return "other-host";
      }
      const dropped = resolveDroppedSession(serverId, payload);
      if (!dropped) {
        toast.error(t("workspace.tabs.actions.dropSessionNoSession"));
        return "no-session";
      }
      const existingTab = input.uiTabs.find(
        (tab) => tab.target.kind === "agent" && tab.target.agentId === dropped.agentId,
      );
      const plan = planSidebarSessionDrop({
        zone: target.zone,
        paneId: target.paneId,
        existingTabId: existingTab?.tabId ?? null,
        homeWorkspaceId: dropped.homeWorkspaceId,
        layoutWorkspaceId: input.workspaceId,
      });
      const tabId = applySidebarDropPlan(workspaceKey, dropped.agentId, plan);
      if (tabId) input.navigateToTabId(tabId);
      return "dropped";
    },
  );

  useEffect(() => {
    if (!enabled || !workspaceKey) return undefined;
    return registerSidebarDropHost({ serverId, workspaceKey, drop });
  }, [drop, enabled, serverId, workspaceKey]);
}
