import { Text, View } from "react-native";
import { ListChecks } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { sameTaskProgress, type TaskProgress, workspaceTaskProgress } from "@/agent-tasks/model";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSessionStore } from "@/stores/session-store";
import type { Theme } from "@/styles/theme";

const ChecklistIcon = withUnistyles(ListChecks);
const iconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/** The workspace's running agent task lists; null when no chat in it has open tasks. */
export function useWorkspaceTaskProgress(
  serverId: string,
  workspaceId: string,
): TaskProgress | null {
  return useStoreWithEqualityFn(
    useSessionStore,
    (state) => workspaceTaskProgress(state.sessions[serverId]?.agents, workspaceId),
    sameTaskProgress,
  );
}

/**
 * The checklist mark and "done/total" for the agents' own plans. Deliberately quiet — the same
 * muted weight as the open-tab count — so it reads as the agent's progress, not as a Stream ask
 * waiting on the user.
 */
export function WorkspaceTaskCountBadge({
  progress,
  testID = "sidebar-workspace-task-count",
}: {
  progress: TaskProgress | null;
  testID?: string;
}) {
  const { t } = useTranslation();
  if (!progress) return null;
  const label = t("sidebar.agentTasks", {
    completed: progress.completed,
    total: progress.total,
  });
  const active = progress.active ? t("sidebar.agentActiveTask", { task: progress.active }) : null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <View
          style={styles.badge}
          accessible
          accessibilityLabel={active ? `${label}. ${active}` : label}
          accessibilityRole="text"
        >
          <ChecklistIcon size={12} uniProps={iconColor} />
          <Text style={styles.count} testID={testID}>
            {progress.completed}/{progress.total}
          </Text>
        </View>
      </TooltipTrigger>
      <TooltipContent>
        <Text style={styles.tooltip}>{label}</Text>
        {active ? (
          <Text style={styles.tooltipActive} numberOfLines={2}>
            {active}
          </Text>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}

export function WorkspaceTaskCount({
  serverId,
  workspaceId,
}: {
  serverId: string;
  workspaceId: string;
}) {
  const progress = useWorkspaceTaskProgress(serverId, workspaceId);
  return <WorkspaceTaskCountBadge progress={progress} />;
}

const styles = StyleSheet.create((theme) => ({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    height: 20,
    flexShrink: 0,
  },
  count: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    fontVariant: ["tabular-nums"],
    lineHeight: 20,
  },
  tooltip: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  tooltipActive: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    maxWidth: 280,
  },
}));
