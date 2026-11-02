import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import * as Clipboard from "expo-clipboard";
import { useShallow } from "zustand/react/shallow";
import { getIsElectron } from "@/constants/platform";
import { useToast } from "@/contexts/toast-context";
import { getDesktopHost } from "@/desktop/host";
import { useArchiveAgent } from "@/hooks/use-archive-agent";
import { useHostFeature } from "@/runtime/host-features";
import {
  buildAgentAttachCommand,
  buildAgentTabControlMenuEntries,
  type AgentTabControlActions,
  type AgentTabControlLabels,
} from "@/screens/workspace/agent-tab-control-menu";
import type { WorkspaceTabMenuEntry } from "@/screens/workspace/workspace-tab-menu";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { useSessionStore } from "@/stores/session-store";
import { confirmDialog } from "@/utils/confirm-dialog";
import { showProviderNoticeToast } from "@/utils/provider-notice-toast";

const EMPTY_QUEUE: ReadonlyArray<{ id: string; text: string }> = [];

function restartToastMessage(
  result: { queuedAfter: number | null; recoveredHead: { outcome: string } | null },
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (result.recoveredHead?.outcome === "resend") {
    return t("workspace.tabs.toasts.restartedAgentResent");
  }
  const queued = result.queuedAfter ?? 0;
  if (queued > 0) return t("workspace.tabs.toasts.restartedAgentQueue", { count: queued });
  return t("workspace.tabs.toasts.restartedAgent");
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Restart / Interrupt / mode / queue / attach / new window / archive for an agent
 * tab's context menu. Same pattern as useMarkTabUnreadMenuEntries: each tab
 * surface appends these to its menu without new props threaded through the tree.
 */
export function useAgentTabControlMenuEntries(input: {
  tab: WorkspaceTabDescriptor;
  serverId: string;
  menuTestIDBase: string;
}): WorkspaceTabMenuEntry[] {
  const { t } = useTranslation();
  const toast = useToast();
  const { archiveAgent } = useArchiveAgent();
  const { tab, menuTestIDBase } = input;
  const serverId = tab.scope?.serverId ?? input.serverId;
  const agentId = tab.target.kind === "agent" ? tab.target.agentId : null;
  const restartSupported = useHostFeature(serverId, "agentRestart");
  const queueDrainSupported = useHostFeature(serverId, "queueDrain");
  const queueSendNowSupported = useHostFeature(serverId, "queueSendNow");
  const agentState = useSessionStore(
    useShallow((state) => {
      const agent = agentId ? state.sessions[serverId]?.agents?.get(agentId) : undefined;
      return {
        exists: !!agent,
        status: agent?.status ?? "idle",
        modes: agent?.availableModes ?? null,
        currentModeId: agent?.currentModeId ?? null,
      };
    }),
  );
  const queue = useSessionStore((state) =>
    agentId ? (state.sessions[serverId]?.queuedMessages.get(agentId) ?? EMPTY_QUEUE) : EMPTY_QUEUE,
  );

  const getClient = useCallback(() => {
    const client = useSessionStore.getState().sessions[serverId]?.client ?? null;
    if (!client) toast.error(t("workspace.terminal.hostDisconnected"));
    return client;
  }, [serverId, t, toast]);

  const actions = useMemo<AgentTabControlActions>(
    () => ({
      onRestart: (id) => {
        const client = getClient();
        if (!client) return;
        toast.show(t("workspace.tabs.toasts.restartingAgent"), { durationMs: null });
        void client
          .restartAgent(id)
          .then((result) => {
            toast.show(restartToastMessage(result, t), { variant: "success" });
            return undefined;
          })
          .catch((error) =>
            toast.error(errorMessage(error, t("workspace.tabs.toasts.failedToRestartAgent"))),
          );
      },
      onInterrupt: (id) => {
        const client = getClient();
        if (!client) return;
        void client
          .cancelAgent(id)
          .catch((error) => toast.error(errorMessage(error, String(error))));
      },
      onSetMode: (id, modeId) => {
        const client = getClient();
        if (!client) return;
        void client
          .setAgentMode(id, modeId)
          .then((notice) => showProviderNoticeToast(toast, notice))
          .catch((error) => toast.error(errorMessage(error, String(error))));
      },
      onSendQueuedNow: (id, itemId) => {
        const client = getClient();
        if (!client) return;
        void client
          .sendQueuedAgentMessageNow(id, itemId)
          .catch((error) => toast.error(errorMessage(error, String(error))));
      },
      onDeliverQueue: (id) => {
        const client = getClient();
        if (!client) return;
        toast.show(t("workspace.tabs.toasts.queueDelivered"));
        void client
          .drainAgentQueue(id)
          .catch((error) => toast.error(errorMessage(error, String(error))));
      },
      onClearQueue: (id) => {
        void confirmDialog({
          title: t("workspace.tabs.menu.queueClearConfirmTitle"),
          message: t("workspace.tabs.menu.queueClearConfirmMessage", {
            count:
              useSessionStore.getState().sessions[serverId]?.queuedMessages.get(id)?.length ?? 0,
          }),
          confirmLabel: t("workspace.tabs.menu.queueClear"),
          destructive: true,
        })
          .then((confirmed) => (confirmed ? getClient() : null))
          .then((client) => client?.clearAgentQueue(id))
          .then((result) => {
            if (result) {
              toast.show(t("workspace.tabs.toasts.queueCleared", { count: result.removed ?? 0 }));
            }
            return undefined;
          })
          .catch((error) => toast.error(errorMessage(error, String(error))));
      },
      onCopyAttachCommand: (id) => {
        void Clipboard.setStringAsync(buildAgentAttachCommand(id))
          .then(() => {
            toast.copied(t("workspace.tabs.toasts.attachCommandCopiedLabel"));
            return undefined;
          })
          .catch(() => toast.error(t("workspace.tabs.toasts.copyFailed")));
      },
      onOpenInNewWindow: (id) => {
        void getDesktopHost()
          ?.window?.openNew?.({ agent: { serverId, agentId: id } })
          ?.catch(() => toast.error(t("sidebar.project.actions.openNewWindowFailed")));
      },
      onArchive: (id) => {
        void archiveAgent({ serverId, agentId: id }).catch((error) =>
          toast.error(errorMessage(error, String(error))),
        );
      },
    }),
    [archiveAgent, getClient, serverId, t, toast],
  );

  const labels = useMemo<AgentTabControlLabels>(
    () => ({
      restartAgent: t("workspace.tabs.menu.restartAgent"),
      restartAgentTooltip: t("workspace.tabs.menu.restartAgentTooltip"),
      interruptAgent: t("workspace.tabs.menu.interruptAgent"),
      modeItem: (mode) => t("workspace.tabs.menu.modeItem", { mode }),
      queueHeader: (count) => t("workspace.tabs.menu.queueHeader", { count }),
      queueSendNow: (preview) => t("workspace.tabs.menu.queueSendNow", { preview }),
      queueMore: (count) => t("workspace.tabs.menu.queueMore", { count }),
      queueDeliver: t("workspace.tabs.menu.queueDeliver"),
      queueClear: t("workspace.tabs.menu.queueClear"),
      copyAttachCommand: t("workspace.tabs.menu.copyAttachCommand"),
      openInNewWindow: t("workspace.tabs.menu.openInNewWindow"),
      archiveAgent: t("workspace.tabs.menu.archiveAgent"),
    }),
    [t],
  );

  return useMemo(() => {
    if (!agentId || !agentState.exists) return [];
    return buildAgentTabControlMenuEntries({
      state: {
        agentId,
        status: agentState.status,
        modes: agentState.modes ?? [],
        currentModeId: agentState.currentModeId,
        queue,
        features: {
          restart: restartSupported,
          queueDrain: queueDrainSupported,
          queueSendNow: queueSendNowSupported,
        },
        canOpenInNewWindow: getIsElectron(),
      },
      actions,
      labels,
      menuTestIDBase,
    });
  }, [
    actions,
    agentId,
    agentState,
    labels,
    menuTestIDBase,
    queue,
    queueDrainSupported,
    queueSendNowSupported,
    restartSupported,
  ]);
}
