import { useCallback, useMemo, type ReactElement, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ChevronDown, ChevronLeft, ChevronUp, SquareArrowOutUpRight, X } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { getProviderIcon } from "@/components/provider-icons";
import { mutedIconColorMapping } from "@/components/ui/icon-color";
import {
  PaneContentToolbar,
  ToolbarButton,
  ToolbarControls,
} from "@/components/ui/pane-content-toolbar";
import { StatusBadge } from "@/components/ui/status-badge";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import {
  WorkspaceTabIcon,
  type WorkspaceTabPresentation,
} from "@/screens/workspace/workspace-tab-presentation";
import { SidePanelModeSwitch, SUBTHREADS_TOGGLE_SHORTCUT_ID } from "./mode-switch";
import type { SidePanelMode, SubthreadRow, SubthreadSelection, SubthreadSummary } from "./model";

const ThemedChevronLeft = withUnistyles(ChevronLeft);
const ThemedChevronUp = withUnistyles(ChevronUp);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedOpenInTab = withUnistyles(SquareArrowOutUpRight);
const ThemedX = withUnistyles(X);

const TOOLBAR_ICON_SIZE = 16;

export interface SubthreadsDrawerProps {
  serverId: string;
  parentLabel: string;
  rows: readonly SubthreadRow[];
  summary: SubthreadSummary;
  selected: SubthreadRow | null;
  onSelect: (selection: SubthreadSelection) => void;
  onBack: () => void;
  onStep: (delta: 1 | -1) => void;
  onClose: () => void;
  onOpenInTab: (row: SubthreadRow) => void;
  /** The session also has a checklist, so the list header switches between the two. */
  showModeSwitch: boolean;
  onModeChange: (mode: SidePanelMode) => void;
  /** Renders the selected subthread's own chat (managed) or read-only timeline (provider). */
  children: ReactNode;
}

export function SubthreadsDrawer(props: SubthreadsDrawerProps): ReactElement {
  const { selected } = props;
  return (
    <View style={styles.drawer} testID="subthreads-drawer">
      {selected ? <ThreadHeader {...props} selected={selected} /> : <ListHeader {...props} />}
      {selected ? (
        <View style={styles.thread} testID={`subthreads-thread-${selected.id}`}>
          {props.children}
        </View>
      ) : (
        <SubthreadList {...props} />
      )}
    </View>
  );
}

function rowLabel(t: TFunction, row: SubthreadRow): string {
  return row.label ?? t("common.states.loading");
}

/** One phrase per state, in the sidebar's status vocabulary, for rows and screen readers. */
function stateLabel(t: TFunction, row: SubthreadRow): string {
  if (row.needsInput) return t("subthreads.state.needsInput");
  if (row.bucket === "failed") return t("subthreads.state.failed");
  if (row.bucket === "running") return t("subthreads.state.working");
  if (row.unread) return t("subthreads.state.unread");
  return t("subthreads.state.done");
}

export function buildSubthreadsSummaryLabel(t: TFunction, summary: SubthreadSummary): string {
  const parts: string[] = [];
  if (summary.needsInput === 1) parts.push(t("subthreads.summary.needsInputOne"));
  if (summary.needsInput > 1) {
    parts.push(t("subthreads.summary.needsInputMany", { count: summary.needsInput }));
  }
  if (summary.failed > 0) parts.push(t("subthreads.summary.failed", { count: summary.failed }));
  if (summary.unread > 0) parts.push(t("subthreads.summary.unread", { count: summary.unread }));
  if (summary.running > 0) parts.push(t("subthreads.summary.working", { count: summary.running }));
  if (parts.length > 0) return parts.join(" · ");
  return summary.total === 1
    ? t("subthreads.summary.totalOne")
    : t("subthreads.summary.totalMany", { count: summary.total });
}

function ListHeader({
  summary,
  onClose,
  showModeSwitch,
  onModeChange,
}: SubthreadsDrawerProps): ReactElement {
  const { t } = useTranslation();
  const shortcut = useShortcutKeys(SUBTHREADS_TOGGLE_SHORTCUT_ID);
  return (
    <PaneContentToolbar style={styles.toolbar} testID="subthreads-list-header">
      {showModeSwitch ? (
        <View style={styles.modeSwitch}>
          <SidePanelModeSwitch mode="subagents" onModeChange={onModeChange} />
        </View>
      ) : null}
      <View style={styles.titleBlock}>
        {showModeSwitch ? null : (
          <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
            {t("subthreads.title")}
          </Text>
        )}
        <Text style={styles.meta} numberOfLines={1} testID="subthreads-summary">
          {buildSubthreadsSummaryLabel(t, summary)}
        </Text>
      </View>
      <ToolbarControls>
        <ToolbarButton
          label={t("subthreads.close")}
          shortcut={shortcut}
          onPress={onClose}
          testID="subthreads-close"
        >
          <ThemedX size={TOOLBAR_ICON_SIZE} uniProps={mutedIconColorMapping} />
        </ToolbarButton>
      </ToolbarControls>
    </PaneContentToolbar>
  );
}

function ThreadHeader({
  serverId,
  parentLabel,
  rows,
  selected,
  onBack,
  onStep,
  onClose,
  onOpenInTab,
}: SubthreadsDrawerProps & { selected: SubthreadRow }): ReactElement {
  const { t } = useTranslation();
  const shortcut = useShortcutKeys(SUBTHREADS_TOGGLE_SHORTCUT_ID);
  const presentation = useRowPresentation(selected, serverId, t);
  const handleOpenInTab = useCallback(() => onOpenInTab(selected), [onOpenInTab, selected]);
  const handlePrevious = useCallback(() => onStep(-1), [onStep]);
  const handleNext = useCallback(() => onStep(1), [onStep]);
  const label = rowLabel(t, selected);
  return (
    <View>
      <PaneContentToolbar style={styles.threadToolbar} testID="subthreads-thread-header">
        <ToolbarButton label={t("subthreads.back")} onPress={onBack} testID="subthreads-back">
          <ThemedChevronLeft size={TOOLBAR_ICON_SIZE} uniProps={mutedIconColorMapping} />
        </ToolbarButton>
        <View style={styles.targetBlock}>
          <WorkspaceTabIcon presentation={presentation} backdrop="surface0" />
          <View style={styles.titleBlock}>
            <Text style={styles.title} numberOfLines={1} testID="subthreads-target-title">
              {label}
            </Text>
            <Text style={styles.meta} numberOfLines={1} testID="subthreads-target-path">
              {t("subthreads.targetPath", { parent: parentLabel, state: stateLabel(t, selected) })}
            </Text>
          </View>
        </View>
        <ToolbarControls>
          {rows.length > 1 ? (
            <>
              <ToolbarButton
                label={t("subthreads.previous")}
                onPress={handlePrevious}
                testID="subthreads-previous"
              >
                <ThemedChevronUp size={TOOLBAR_ICON_SIZE} uniProps={mutedIconColorMapping} />
              </ToolbarButton>
              <ToolbarButton
                label={t("subthreads.next")}
                onPress={handleNext}
                testID="subthreads-next"
              >
                <ThemedChevronDown size={TOOLBAR_ICON_SIZE} uniProps={mutedIconColorMapping} />
              </ToolbarButton>
            </>
          ) : null}
          <ToolbarButton
            label={t("subthreads.openInTab")}
            onPress={handleOpenInTab}
            testID="subthreads-open-in-tab"
          >
            <ThemedOpenInTab size={TOOLBAR_ICON_SIZE} uniProps={mutedIconColorMapping} />
          </ToolbarButton>
          <ToolbarButton
            label={t("subthreads.close")}
            shortcut={shortcut}
            onPress={onClose}
            testID="subthreads-close"
          >
            <ThemedX size={TOOLBAR_ICON_SIZE} uniProps={mutedIconColorMapping} />
          </ToolbarButton>
        </ToolbarControls>
      </PaneContentToolbar>
      {selected.canReply ? null : (
        <View style={styles.readOnlyStrip} testID="subthreads-read-only">
          <Text style={styles.meta}>{t("subthreads.readOnly", { parent: parentLabel })}</Text>
        </View>
      )}
    </View>
  );
}

function useRowPresentation(
  row: SubthreadRow,
  serverId: string,
  t: TFunction,
): WorkspaceTabPresentation {
  return useMemo(() => {
    const label = rowLabel(t, row);
    return {
      key: `subthread_${row.kind}_${row.id}`,
      kind: "agent",
      label,
      subtitle: row.subtitle ?? "",
      tooltip: label,
      modified: false,
      titleState: row.label ? "ready" : "loading",
      icon: getProviderIcon(row.provider, serverId),
      statusBucket: row.bucket,
    };
  }, [row, serverId, t]);
}

function SubthreadList({ serverId, rows, onSelect }: SubthreadsDrawerProps): ReactElement {
  const { t } = useTranslation();
  if (rows.length === 0) {
    return (
      <View style={styles.empty} testID="subthreads-empty">
        <Text style={styles.meta}>{t("subthreads.empty")}</Text>
      </View>
    );
  }
  return (
    <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
      {rows.map((row) => (
        <SubthreadListRow
          key={`${row.kind}:${row.id}`}
          row={row}
          serverId={serverId}
          onSelect={onSelect}
        />
      ))}
    </ScrollView>
  );
}

function SubthreadListRow({
  row,
  serverId,
  onSelect,
}: {
  row: SubthreadRow;
  serverId: string;
  onSelect: (selection: SubthreadSelection) => void;
}): ReactElement {
  const { t } = useTranslation();
  const presentation = useRowPresentation(row, serverId, t);
  const handlePress = useCallback(() => onSelect({ kind: row.kind, id: row.id }), [onSelect, row]);
  const label = rowLabel(t, row);
  const state = stateLabel(t, row);
  const access = row.canReply ? t("subthreads.canReply") : t("subthreads.readOnlyShort");
  const activity = row.activity ? `, ${row.activity.text}` : "";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${state}, ${access}${activity}`}
      accessibilityHint={t("subthreads.openHint")}
      onPress={handlePress}
      style={rowStyle}
      testID={`subthreads-row-${row.id}`}
    >
      {({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => (
        <>
          <WorkspaceTabIcon
            presentation={presentation}
            backdrop={pressed || hovered ? "surface1" : "surface0"}
          />
          <View style={styles.rowText}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {label}
            </Text>
            <Text
              style={row.activity?.kind === "blocker" ? styles.activityBlocker : styles.meta}
              numberOfLines={1}
              testID={`subthreads-row-activity-${row.id}`}
            >
              {row.activity?.text ?? (row.subtitle ? `${row.subtitle} · ${access}` : access)}
            </Text>
          </View>
          <RowState row={row} state={state} />
        </>
      )}
    </Pressable>
  );
}

function RowState({ row, state }: { row: SubthreadRow; state: string }): ReactElement {
  if (row.needsInput) return <StatusBadge label={state} variant="warning" />;
  if (row.bucket === "failed") return <StatusBadge label={state} variant="error" />;
  return <Text style={styles.rowState}>{state}</Text>;
}

function rowStyle({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) {
  return [styles.row, pressed || hovered ? styles.rowActive : null];
}

const styles = StyleSheet.create((theme) => ({
  drawer: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    backgroundColor: theme.colors.surface0,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  // The thread header carries two lines (target and path), so it grows past the one-line
  // toolbar height instead of clipping the path.
  threadToolbar: {
    flexDirection: "row",
    alignItems: "center",
    height: "auto",
    minHeight: theme.spacing[12],
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1.5],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  modeSwitch: {
    flexShrink: 0,
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
    paddingLeft: theme.spacing[1],
  },
  targetBlock: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  title: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  meta: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  readOnlyStrip: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  thread: {
    flex: 1,
    minHeight: 0,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[6],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    minHeight: theme.spacing[12],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
  },
  rowActive: {
    backgroundColor: theme.colors.interactionHighlight,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
  // A waiting approval is the one line the parent's user must act on; it reads as content.
  activityBlocker: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  rowState: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
}));
