import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet, AdaptiveTextInput } from "@/components/adaptive-modal-sheet";
import { AgentStatusDot } from "@/components/agent-status-dot";
import { useAggregatedAgents, type AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { useProjects } from "@/hooks/use-projects";
import { useHosts } from "@/runtime/host-runtime";
import type { ViewTabInput } from "@/stores/views-store";
import { formatTimeAgo } from "@/utils/time";
import { shortSessionId } from "@getpaseo/protocol/search/session-id";

export type ViewSessionPickerRequest =
  | { mode: "pane"; paneId: string | null }
  | { mode: "split"; paneId: string | null; position?: "right" | "bottom" };

export interface ViewSessionPickerRow {
  key: string;
  agent: AggregatedAgent & { workspaceId: string };
  title: string;
  subtitle: string;
  searchText: string;
}

/**
 * Sessions that can be dropped into a split: agents that belong to a workspace, newest activity
 * first. Each row names its provider and short id, and the full id is searchable, so a pasted
 * `9b8394eb` finds the session.
 */
export function buildViewSessionPickerRows(input: {
  agents: AggregatedAgent[];
  workspaceLabelByKey: Map<string, string>;
  showHost: boolean;
  untitledLabel: string;
  /** Restrict to one host (a workspace split can only hold that host's sessions). */
  serverId?: string;
}): ViewSessionPickerRow[] {
  const rows: ViewSessionPickerRow[] = [];
  for (const agent of input.agents) {
    const workspaceId = agent.workspaceId;
    if (!workspaceId || agent.archivedAt) continue;
    if (input.serverId && agent.serverId !== input.serverId) continue;
    const title = agent.title || input.untitledLabel;
    const workspaceLabel =
      input.workspaceLabelByKey.get(`${agent.serverId}:${workspaceId}`) ?? agent.cwd;
    const subtitle = [
      agent.provider,
      shortSessionId(agent.id),
      input.showHost ? agent.serverLabel : null,
      workspaceLabel,
    ]
      .filter(Boolean)
      .join(" · ");
    rows.push({
      key: `${agent.serverId}:${agent.id}`,
      agent: { ...agent, workspaceId },
      title,
      subtitle,
      searchText:
        `${title} ${workspaceLabel} ${agent.serverLabel} ${agent.cwd} ${agent.provider} ${agent.id}`.toLowerCase(),
    });
  }
  return rows;
}

const UNFILTERED_PICKER_ROW_LIMIT = 60;

export function filterViewSessionPickerRows(
  rows: ViewSessionPickerRow[],
  query: string,
): ViewSessionPickerRow[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return rows;
  return rows.filter((row) => terms.every((term) => row.searchText.includes(term)));
}

export function ViewSessionPicker({
  request,
  onClose,
  onPick,
  serverId,
}: {
  request: ViewSessionPickerRequest | null;
  onClose: () => void;
  onPick: (input: ViewTabInput) => void;
  serverId?: string;
}) {
  const { t } = useTranslation();
  const open = request !== null;
  const [query, setQuery] = useState("");
  const { agents } = useAggregatedAgents({ demand: open });
  const { projects } = useProjects({ enabled: open });
  const showHost = useHosts().length > 1;

  const rows = useMemo(() => {
    if (!open) return [];
    const workspaceLabelByKey = new Map<string, string>();
    for (const project of projects) {
      for (const host of project.hosts) {
        for (const workspace of host.workspaces) {
          const name = workspace.title ?? workspace.name;
          const label =
            workspace.currentBranch && workspace.currentBranch !== name
              ? `${project.projectName} · ${workspace.currentBranch}`
              : `${project.projectName} · ${name}`;
          workspaceLabelByKey.set(`${host.serverId}:${workspace.id}`, label);
        }
      }
    }
    return buildViewSessionPickerRows({
      agents,
      workspaceLabelByKey,
      showHost,
      untitledLabel: t("shell.commandCenter.newAgent"),
      serverId,
    });
  }, [agents, open, projects, serverId, showHost, t]);
  // Unfiltered, the most recent sessions are enough to pick from; typing narrows the full list.
  const visibleRows = useMemo(
    () =>
      query.trim()
        ? filterViewSessionPickerRows(rows, query)
        : rows.slice(0, UNFILTERED_PICKER_ROW_LIMIT),
    [query, rows],
  );

  const pick = useCallback(
    (row: ViewSessionPickerRow) => {
      setQuery("");
      onPick({
        scope: { serverId: row.agent.serverId, workspaceId: row.agent.workspaceId },
        target: { kind: "agent", agentId: row.agent.id },
      });
    },
    [onPick],
  );
  const handleClose = useCallback(() => {
    setQuery("");
    onClose();
  }, [onClose]);
  const handleSubmit = useCallback(() => {
    const first = visibleRows[0];
    if (first) pick(first);
  }, [pick, visibleRows]);
  const header = useMemo(
    () => ({
      title: request?.mode === "split" ? t("views.picker.splitTitle") : t("views.picker.addTitle"),
    }),
    [request?.mode, t],
  );

  return (
    <AdaptiveModalSheet
      visible={open}
      onClose={handleClose}
      header={header}
      testID="view-session-picker"
    >
      <View style={styles.body}>
        <AdaptiveTextInput
          initialValue=""
          onChangeText={setQuery}
          placeholder={t("views.picker.searchPlaceholder")}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          onSubmitEditing={handleSubmit}
          style={styles.search}
          testID="view-session-picker-search"
        />
        {visibleRows.length === 0 ? (
          <Text style={styles.emptyText}>{t("views.picker.empty")}</Text>
        ) : (
          visibleRows.map((row) => <ViewSessionPickerItem key={row.key} row={row} onPick={pick} />)
        )}
      </View>
    </AdaptiveModalSheet>
  );
}

function rowStyle({ hovered }: { hovered?: boolean }) {
  return [styles.row, hovered ? styles.rowHovered : null];
}

function ViewSessionPickerItem({
  row,
  onPick,
}: {
  row: ViewSessionPickerRow;
  onPick: (row: ViewSessionPickerRow) => void;
}) {
  const handlePress = useCallback(() => onPick(row), [onPick, row]);
  return (
    <Pressable
      accessibilityRole="button"
      testID={`view-session-picker-row-${row.agent.id}`}
      onPress={handlePress}
      style={rowStyle}
    >
      <AgentStatusDot
        status={row.agent.status}
        requiresAttention={row.agent.requiresAttention}
        attentionReason={row.agent.attentionReason}
        pendingPermissionCount={row.agent.pendingPermissionCount}
        showInactive
      />
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={styles.rowTitle}>
          {row.title}
        </Text>
        <Text numberOfLines={1} style={styles.rowSubtitle}>
          {row.subtitle}
        </Text>
      </View>
      <Text style={styles.rowTime}>{formatTimeAgo(row.agent.lastActivityAt)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing[1],
    paddingBottom: theme.spacing[2],
  },
  search: {
    backgroundColor: theme.colors.surface0,
    color: theme.colors.foreground,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    fontSize: theme.fontSize.base,
    marginBottom: theme.spacing[1],
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingVertical: theme.spacing[3],
    textAlign: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  rowHovered: {
    backgroundColor: theme.colors.surface2,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  rowSubtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  rowTime: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
