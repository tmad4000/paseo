import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { useShallow } from "zustand/react/shallow";
import { getReviewStatus } from "@getpaseo/protocol/agent-labels";
import { AgentStatusMenuTrigger, useAgentStatusMenuPages } from "@/agent-status/menu";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";
import { useMarkTabUnreadMenuEntries } from "@/screens/workspace/use-mark-tab-unread-menu-entries";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { useSidebarCollapsedSectionsStore } from "@/stores/sidebar-collapsed-sections-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { collectAllTabs, findPaneById } from "@/stores/workspace-layout-actions";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { buildDeterministicWorkspaceTabId } from "@/workspace-tabs/identity";
import { buildMarkReadMenuEntries, useAgentReadAction } from "@/workspace/use-agent-read-action";
import { useSidebarModel } from "./sidebar-model";
import { workspaceReviewAgents } from "./workspace-review-model";

const PREVIEW_LIMIT = 3;

export function WorkspaceReviewList({
  serverId,
  workspaceId,
  onNavigate,
}: {
  serverId: string;
  workspaceId: string;
  onNavigate?: () => void;
}) {
  const { searchQuery } = useSidebarModel();
  const agents = useSessionStore(
    useShallow((state) =>
      searchQuery.trim()
        ? []
        : workspaceReviewAgents(state.sessions[serverId]?.agents, workspaceId),
    ),
  );
  const { t } = useTranslation();
  const collapseKey = `review:${serverId}:${workspaceId}`;
  const collapsed = useSidebarCollapsedSectionsStore((state) =>
    state.collapsedWorkspaceGroupKeys.has(collapseKey),
  );
  const toggle = useSidebarCollapsedSectionsStore((state) => state.toggleWorkspaceGroupCollapsed);
  const [showAll, setShowAll] = useState(false);
  const toggleCollapsed = useCallback(() => toggle(collapseKey), [toggle, collapseKey]);
  const toggleAll = useCallback(() => setShowAll((value) => !value), []);
  const expandedState = useMemo(() => ({ expanded: !collapsed }), [collapsed]);
  const showAllState = useMemo(() => ({ expanded: showAll }), [showAll]);
  if (agents.length === 0) return null;
  const visible = showAll ? agents : agents.slice(0, PREVIEW_LIMIT);
  return (
    <View style={styles.list} testID={`workspace-review-list-${serverId}-${workspaceId}`}>
      <Button
        variant="ghost"
        size="sm"
        onPress={toggleCollapsed}
        accessibilityState={expandedState}
        aria-expanded={!collapsed}
        accessibilityLabel={t("sidebar.reviewSessions", { count: agents.length })}
        style={styles.heading}
        textStyle={styles.meta}
      >
        {`${collapsed ? "›" : "⌄"} ${t("sidebar.reviewSessions", { count: agents.length })}`}
      </Button>
      {!collapsed ? (
        <>
          {visible.map((agent) => (
            <ReviewRow
              key={agent.id}
              agent={agent}
              serverId={serverId}
              workspaceId={workspaceId}
              onNavigate={onNavigate}
            />
          ))}
          {agents.length > PREVIEW_LIMIT ? (
            <Button
              variant="ghost"
              size="sm"
              style={styles.heading}
              accessibilityState={showAllState}
              aria-expanded={showAll}
              onPress={toggleAll}
            >
              {showAll
                ? t("sidebar.filterSidebar.matches.fewerTabs")
                : t("sidebar.filterSidebar.matches.moreTabs", {
                    count: agents.length - PREVIEW_LIMIT,
                  })}
            </Button>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function ReviewRow({
  agent,
  serverId,
  workspaceId,
  onNavigate,
}: {
  agent: Agent;
  serverId: string;
  workspaceId: string;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const title = agent.title?.trim() || t("workspace.tabs.fallback.agent");
  const review = getReviewStatus(agent.labels);
  const unread = agent.requiresAttention === true;
  const labels = [
    review ? t(`manualStatus.${review}`) : null,
    unread ? t("subthreads.state.unread") : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const target = useMemo(
    () => ({ kind: "agent" as const, serverId, agentId: agent.id }),
    [agent.id, serverId],
  );
  const pages = useAgentStatusMenuPages(target);
  const tabId = useWorkspaceLayoutStore((state) => {
    const layout = state.layoutByWorkspace[`${serverId}:${workspaceId}`];
    if (layout) {
      const focused = findPaneById(layout.root, layout.focusedPaneId);
      const tabs = collectAllTabs(layout.root);
      const matching = tabs.filter(
        (tab) => tab.target.kind === "agent" && tab.target.agentId === agent.id,
      );
      const matchingTab =
        matching.find((candidate) => candidate.tabId === focused?.focusedTabId) ?? matching[0];
      if (matchingTab) return matchingTab.tabId;
    }
    return buildDeterministicWorkspaceTabId({ kind: "agent", agentId: agent.id });
  });
  const tab = useMemo(
    () => ({
      key: tabId,
      tabId,
      kind: "agent" as const,
      target: { kind: "agent" as const, agentId: agent.id },
    }),
    [agent.id, tabId],
  );
  const unreadEntries = useMarkTabUnreadMenuEntries({
    tab,
    serverId,
    workspaceId,
    menuTestIDBase: `review-${agent.id}`,
  });
  // Opening a review row does not read it by default, so its menus offer the explicit read.
  const readAction = useAgentReadAction({ serverId, agentId: agent.id, unread: false });
  const readEntries = useMemo(
    () =>
      buildMarkReadMenuEntries({
        action: readAction,
        label: t("workspace.tabs.menu.markAsRead"),
        menuTestIDBase: `review-${agent.id}`,
      }),
    [agent.id, readAction, t],
  );
  const open = useCallback(() => {
    onNavigate?.();
    navigateToAgent({ serverId, workspaceId, agentId: agent.id });
  }, [agent.id, serverId, workspaceId, onNavigate]);
  const menuItems = (
    <>
      <AgentStatusMenuTrigger />
      {[...readEntries, ...unreadEntries].map((entry) =>
        entry.kind === "item" ? (
          <ContextMenuItem key={entry.key} onSelect={entry.onSelect} testID={entry.testID}>
            {entry.label}
          </ContextMenuItem>
        ) : null,
      )}
    </>
  );
  return (
    <View style={styles.rowLine}>
      <ContextMenu>
        <ContextMenuTrigger
          onPress={open}
          accessibilityRole="button"
          accessibilityLabel={`${title} · ${labels}`}
          style={styles.row}
          testID={`workspace-review-agent-${agent.id}`}
        >
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {labels}
          </Text>
        </ContextMenuTrigger>
        <ContextMenuContent pages={pages} sheetTitle={title}>
          {menuItems}
        </ContextMenuContent>
      </ContextMenu>
      <DropdownMenu compactMode="sheet">
        <DropdownMenuTrigger
          accessibilityLabel={t("sidebar.reviewActions", { title })}
          style={styles.actions}
          testID={`workspace-review-actions-${agent.id}`}
        >
          <Text style={styles.title}>⋯</Text>
        </DropdownMenuTrigger>
        <DropdownMenuContent pages={pages} sheetTitle={title}>
          {menuItems}
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  list: { paddingLeft: theme.spacing[4], paddingRight: theme.spacing[2] },
  heading: { justifyContent: "flex-start" },
  rowLine: { flexDirection: "row", alignItems: "center" },
  actions: { width: 44, height: 44, justifyContent: "center", alignItems: "center" },
  row: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.sm,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
  meta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
}));
