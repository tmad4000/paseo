import { useCallback, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { CornerUpLeft, MessageSquareReply, SendHorizontal } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { v4 as uuid } from "uuid";
import { useStoreWithEqualityFn } from "zustand/traditional";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useToast } from "@/contexts/toast-context";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useHostFeature } from "@/runtime/host-features";
import { selectAgentTurnPresentation, useSessionStore } from "@/stores/session-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { buildSendBackText, latestAssistantReply, threadOriginOf } from "./model";

/**
 * Shown in a thread's own chat, beside Pin: back to the main chat, and "Send to main", which
 * queues the thread's latest answer in the main chat as a quoted message. Queued, never
 * interrupting: the main agent reads it when its current turn ends.
 */
export function ThreadOriginControls({
  serverId,
  agentId,
  layoutWorkspaceId,
}: {
  serverId: string;
  agentId: string;
  layoutWorkspaceId: string;
}): ReactElement | null {
  const { t } = useTranslation();
  const toast = useToast();
  const compact = useIsCompactFormFactor();
  const origin = useStoreWithEqualityFn(
    useSessionStore,
    (state) => {
      const session = state.sessions[serverId];
      return threadOriginOf(session?.agents.get(agentId) ?? session?.agentDetails.get(agentId));
    },
    threadOriginsEqual,
  );
  const parent = useSessionStore((state) =>
    origin ? state.sessions[serverId]?.agents.get(origin.parentAgentId) : undefined,
  );
  const threadTitle = useSessionStore(
    (state) => state.sessions[serverId]?.agents.get(agentId)?.title?.trim() || agentId.slice(0, 8),
  );
  const threadBusy = useSessionStore(
    (state) => selectAgentTurnPresentation(state.sessions[serverId], agentId).isActive,
  );
  const hasReply = useSessionStore((state) =>
    Boolean(latestAssistantReply(state.sessions[serverId]?.agentStreamTail.get(agentId) ?? [])),
  );
  const canQueue = useHostFeature(serverId, "agentMessageQueue");
  const parentTitle = parent?.title?.trim() || origin?.parentAgentId.slice(0, 8) || "";

  const openMain = useCallback(() => {
    const workspaceKey = buildWorkspaceTabPersistenceKey({
      serverId,
      workspaceId: layoutWorkspaceId,
    });
    if (!origin || !parent || !workspaceKey) return;
    useWorkspaceLayoutStore.getState().openTab({
      workspaceKey,
      target: { kind: "agent", agentId: origin.parentAgentId },
      intent: "reveal",
      pin: Boolean(parent.workspaceId && parent.workspaceId !== layoutWorkspaceId),
    });
  }, [layoutWorkspaceId, origin, parent, serverId]);

  const sendBack = useMutation({
    mutationFn: async () => {
      if (!origin || !parent) throw new Error(t("threads.parentUnavailable"));
      const reply = latestAssistantReply(
        useSessionStore.getState().sessions[serverId]?.agentStreamTail.get(agentId) ?? [],
      );
      if (!reply) throw new Error(t("threads.noReplyYet"));
      const client = getHostRuntimeStore().getClient(serverId);
      if (!client) throw new Error(t("sidebar.workspace.toasts.hostDisconnected"));
      await client.enqueueAgentMessage({
        agentId: origin.parentAgentId,
        itemId: uuid(),
        text: buildSendBackText({ threadTitle, threadAgentId: agentId, reply }),
      });
    },
    onSuccess: () => toast.show(t("threads.sentToMain", { title: parentTitle })),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : t("threads.sendToMainFailed")),
  });
  const sendBackMutate = sendBack.mutate;
  const handleSendBack = useCallback(() => {
    if (!sendBack.isPending) sendBackMutate();
  }, [sendBack.isPending, sendBackMutate]);
  const sendDisabled =
    !parent || Boolean(parent.archivedAt) || !canQueue || !hasReply || threadBusy;
  const sendHint = useMemo(() => {
    if (!canQueue) return t("threads.sendToMainUpdateHost");
    if (!hasReply || threadBusy) return t("threads.noReplyYet");
    return undefined;
  }, [canQueue, hasReply, t, threadBusy]);

  if (!origin) return null;
  // One icon-sized control: the chat header beside Pin is narrow in a split thread pane.
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        accessibilityRole="button"
        accessibilityLabel={t("threads.menuLabel", { title: parentTitle })}
        style={compact ? styles.compactTrigger : styles.trigger}
        testID="thread-origin-menu"
      >
        {({ hovered, open }) => (
          <ThemedReplyIcon
            size={ICON_SIZE.sm}
            uniProps={hovered || open ? foregroundColorMapping : foregroundMutedColorMapping}
          />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" minWidth={240} side="bottom">
        <DropdownMenuItem
          leading={backIcon}
          disabled={!parent}
          onSelect={openMain}
          testID="thread-back-to-main"
        >
          {t("threads.backToMain", { title: parentTitle })}
        </DropdownMenuItem>
        <DropdownMenuItem
          leading={sendIcon}
          disabled={sendDisabled}
          description={sendHint}
          status={sendBack.isPending ? "pending" : undefined}
          onSelect={handleSendBack}
          testID="thread-send-to-main"
        >
          {t("threads.sendToMainLabel", { title: parentTitle })}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const ThemedReplyIcon = withUnistyles(MessageSquareReply);
const ThemedBackIcon = withUnistyles(CornerUpLeft);
const ThemedSendIcon = withUnistyles(SendHorizontal);
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const backIcon = <ThemedBackIcon size={ICON_SIZE.sm} uniProps={foregroundColorMapping} />;
const sendIcon = <ThemedSendIcon size={ICON_SIZE.sm} uniProps={foregroundColorMapping} />;

function threadOriginsEqual(
  left: ReturnType<typeof threadOriginOf>,
  right: ReturnType<typeof threadOriginOf>,
): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.parentAgentId === right.parentAgentId &&
      left.anchor === right.anchor)
  );
}

const styles = StyleSheet.create((theme) => ({
  trigger: { padding: theme.spacing[2], borderRadius: theme.borderRadius.md },
  compactTrigger: {
    minHeight: 44,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
  },
}));
