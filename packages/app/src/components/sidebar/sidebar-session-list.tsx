import { memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { CircleCheck, MoreVertical } from "lucide-react-native";
import { AgentStatusMenuTrigger, useAgentStatusMenuPages } from "@/agent-status/menu";
import { getProviderIcon } from "@/components/provider-icons";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isNative, isWeb } from "@/constants/platform";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useToast } from "@/contexts/toast-context";
import { useArchiveAgent } from "@/hooks/use-archive-agent";
import { useHosts } from "@/runtime/host-runtime";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { sessionPinnedAt, setSessionPinned } from "@/session-pins/model";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useSessionStore } from "@/stores/session-store";
import { collectAllTabs, findPaneById } from "@/stores/workspace-layout-actions";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import type { Theme } from "@/styles/theme";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { useAgentReadAction } from "@/workspace/use-agent-read-action";
import { SessionStatusIndicator } from "./project-leading-visual";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import { STATUS_BUCKET_LABELS } from "@/hooks/sidebar-status-view-model";
import { useAgentSeenNotRead } from "@/workspace/use-agent-seen";
import { getSidebarRowBackdrop } from "./sidebar-row-backdrop";
import { sidebarSessionMeta, type SidebarSessionRow } from "./sidebar-sessions";
import { WorkspaceTimestamp } from "./workspace-trailing";

const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const ThemedCircleCheck = withUnistyles(CircleCheck);
const ThemedMoreVertical = withUnistyles(MoreVertical);

function ProviderGlyph({
  provider,
  serverId,
  color,
}: {
  provider: string;
  serverId: string;
  color?: string;
}) {
  const Icon = getProviderIcon(provider, serverId);
  return <Icon size={14} color={color ?? "currentColor"} />;
}
const ThemedProviderGlyph = withUnistyles(ProviderGlyph);

/**
 * Sessions grouping's body: one flat list of chats, each opening its tab in its home workspace
 * (docs/sidebar-sorting.md#sessions-grouping). The rows come from the sidebar model, already
 * filtered and sorted.
 */
export function SidebarSessionList({
  rows,
  onNavigate,
}: {
  rows: readonly SidebarSessionRow[];
  onNavigate?: () => void;
}) {
  const hosts = useHosts();
  const showHost = hosts.length > 1;
  const hostLabels = useMemo(
    () => new Map(hosts.map((host) => [host.serverId, host.label || host.serverId])),
    [hosts],
  );
  const selection = useActiveWorkspaceSelection();
  const focusedAgentId = useWorkspaceLayoutStore((state) => {
    if (!selection) return null;
    const layout = state.layoutByWorkspace[`${selection.serverId}:${selection.workspaceId}`];
    if (!layout) return null;
    const focusedTabId = findPaneById(layout.root, layout.focusedPaneId)?.focusedTabId;
    const tab = collectAllTabs(layout.root).find((candidate) => candidate.tabId === focusedTabId);
    return tab?.target.kind === "agent" ? tab.target.agentId : null;
  });
  if (rows.length === 0) return null;
  return (
    <View style={styles.list} testID="sidebar-session-list">
      {rows.map((row) => (
        <SessionRow
          key={row.key}
          row={row}
          hostLabel={showHost ? (hostLabels.get(row.serverId) ?? row.serverId) : null}
          selected={
            selection?.serverId === row.serverId &&
            selection.workspaceId === row.workspaceId &&
            focusedAgentId === row.agentId
          }
          onNavigate={onNavigate}
        />
      ))}
    </View>
  );
}

const SessionRow = memo(function SessionRow({
  row,
  hostLabel,
  selected,
  onNavigate,
}: {
  row: SidebarSessionRow;
  hostLabel: string | null;
  selected: boolean;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const isCompact = useIsCompactFormFactor();
  const isTouch = isNative || isCompact;
  const { archiveAgent } = useArchiveAgent();
  const [renaming, setRenaming] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const title = row.title ?? t("workspace.tabs.fallback.agent");
  const meta = sidebarSessionMeta(row, hostLabel);
  const pinned = useSessionStore((state) => {
    const agent = state.sessions[row.serverId]?.agents.get(row.agentId);
    return agent ? sessionPinnedAt(agent) !== null : false;
  });
  const statusTarget = useMemo(
    () => ({ kind: "agent" as const, serverId: row.serverId, agentId: row.agentId }),
    [row.agentId, row.serverId],
  );
  const pages = useAgentStatusMenuPages(statusTarget);
  // Opening a session row does not read it, so the row offers the explicit read, as review rows do.
  const readAction = useAgentReadAction({
    serverId: row.serverId,
    agentId: row.agentId,
    unread: false,
  });
  const open = useCallback(() => {
    onNavigate?.();
    navigateToAgent({ serverId: row.serverId, agentId: row.agentId, workspaceId: row.workspaceId });
  }, [onNavigate, row.agentId, row.serverId, row.workspaceId]);
  const togglePin = useCallback(() => {
    const agent = useSessionStore.getState().sessions[row.serverId]?.agents.get(row.agentId);
    const client = getHostRuntimeStore().getClient(row.serverId);
    if (!agent || !client) {
      toast.error(t("sidebar.workspace.toasts.hostDisconnected"));
      return;
    }
    void setSessionPinned({ ...agent, serverId: row.serverId }, !pinned, (id, updates) =>
      client.updateAgent(id, updates),
    ).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : String(error));
    });
  }, [pinned, row.agentId, row.serverId, t, toast]);
  const archive = useCallback(() => {
    // Timeouts are swallowed like the other archive surfaces: the host still processes it.
    void archiveAgent({ serverId: row.serverId, agentId: row.agentId }).catch(() => {});
  }, [archiveAgent, row.agentId, row.serverId]);
  const startRename = useCallback(() => setRenaming(true), []);
  const stopRename = useCallback(() => setRenaming(false), []);
  const submitRename = useCallback(
    async (nextTitle: string) => {
      const client = getHostRuntimeStore().getClient(row.serverId);
      if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
      await client.updateAgent(row.agentId, { name: nextTitle.trim() });
    },
    [row.agentId, row.serverId, t],
  );
  const testBase = `sidebar-session-${row.serverId}-${row.agentId}`;
  const seenNotRead = useAgentSeenNotRead(row.serverId, row.agentId);
  const menuItems = (
    <>
      {readAction.canMarkRead ? (
        <ContextMenuItem onSelect={readAction.markRead} testID={`${testBase}-mark-as-read`}>
          {t("workspace.tabs.menu.markAsRead")}
        </ContextMenuItem>
      ) : null}
      <AgentStatusMenuTrigger />
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={togglePin} testID={`${testBase}-pin`}>
        {pinned ? t("sessionPins.unpin") : t("sessionPins.pin")}
      </ContextMenuItem>
      <ContextMenuItem onSelect={startRename} testID={`${testBase}-rename`}>
        {t("workspace.tabs.menu.rename")}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem destructive onSelect={archive} testID={`${testBase}-archive`}>
        {t("sidebarSessions.archive")}
      </ContextMenuItem>
    </>
  );
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  const rowStyle = useCallback(
    ({ pressed, hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      selected && styles.rowSelected,
      hovered && !pressed && !selected && styles.rowHovered,
      pressed && styles.rowPressed,
    ],
    [selected],
  );
  const backdrop = getSidebarRowBackdrop({
    isDragging: false,
    isPressed: false,
    selected,
    isHovered: false,
  });
  return (
    <View style={styles.rowLine}>
      <ContextMenu>
        <ContextMenuTrigger
          onPress={open}
          accessibilityRole={isWeb ? undefined : "button"}
          accessibilityLabel={t("sidebarSessions.open", { title, meta })}
          accessibilityState={accessibilityState}
          style={rowStyle}
          testID={testBase}
        >
          <IconTooltip
            // Done draws no badge, so there is no status mark to explain.
            label={row.statusBucket === "done" ? null : STATUS_BUCKET_LABELS[row.statusBucket]}
            side="right"
          >
            <SessionStatusIndicator
              statusBucket={row.statusBucket}
              running={row.running}
              backdrop={backdrop}
              seen={seenNotRead}
            >
              <ThemedProviderGlyph
                provider={row.provider}
                serverId={row.serverId}
                uniProps={foregroundMutedColorMapping}
              />
            </SessionStatusIndicator>
          </IconTooltip>
          <View style={styles.body}>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            <Text style={styles.meta} numberOfLines={1} testID={`${testBase}-meta`}>
              {meta}
            </Text>
          </View>
          <WorkspaceTimestamp lastActiveAt={row.displayAt} testID={`${testBase}-timestamp`} />
        </ContextMenuTrigger>
        <ContextMenuContent pages={pages} sheetTitle={title}>
          {menuItems}
        </ContextMenuContent>
      </ContextMenu>
      {readAction.canMarkRead ? (
        <IconTooltip label={t("sidebar.workspace.actions.markAsRead")} wrap={false}>
          <Pressable
            hitSlop={isTouch ? 6 : 4}
            style={isTouch ? styles.touchAction : styles.action}
            accessibilityRole={isWeb ? undefined : "button"}
            accessibilityLabel={t("sidebar.workspace.actions.markAsReadNamed", { name: title })}
            onPress={readAction.markRead}
            testID={`${testBase}-read`}
          >
            {renderMarkReadIcon}
          </Pressable>
        </IconTooltip>
      ) : null}
      <DropdownMenu compactMode="sheet" open={actionsOpen} onOpenChange={setActionsOpen}>
        <IconTooltip
          label={t("sidebarSessions.actions", { title })}
          disabled={actionsOpen}
          wrap={false}
        >
          <DropdownMenuTrigger
            accessibilityLabel={t("sidebarSessions.actions", { title })}
            style={isTouch ? styles.touchAction : styles.action}
            testID={`${testBase}-actions`}
          >
            <ThemedMoreVertical size={14} uniProps={foregroundMutedColorMapping} />
          </DropdownMenuTrigger>
        </IconTooltip>
        <DropdownMenuContent pages={pages} sheetTitle={title}>
          {menuItems}
        </DropdownMenuContent>
      </DropdownMenu>
      <AdaptiveRenameModal
        visible={renaming}
        title={t("workspace.tabs.menu.renameAgent")}
        initialValue={row.title ?? ""}
        submitLabel={t("workspace.tabs.menu.rename")}
        maxLength={200}
        onClose={stopRename}
        onSubmit={submitRename}
        testID={`${testBase}-rename-modal`}
      />
    </View>
  );
});

function renderMarkReadIcon({
  hovered,
  pressed,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return (
    <ThemedCircleCheck
      size={14}
      uniProps={hovered || pressed ? foregroundColorMapping : foregroundMutedColorMapping}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  list: { paddingHorizontal: theme.spacing[2] },
  rowLine: { flexDirection: "row", alignItems: "center", marginBottom: theme.spacing[0.5] },
  // Kept in step with the workspace row's geometry so switching modes does not shift the rail.
  row: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    userSelect: "none",
  },
  rowHovered: { backgroundColor: theme.colors.surfaceSidebarHover },
  rowSelected: { backgroundColor: theme.colors.surfaceSidebarSelected },
  rowPressed: { backgroundColor: theme.colors.surface2 },
  body: { flex: 1, minWidth: 0, gap: theme.spacing[0.5] },
  title: {
    lineHeight: 20,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
  meta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  action: {
    width: 24,
    height: 24,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  touchAction: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
}));
