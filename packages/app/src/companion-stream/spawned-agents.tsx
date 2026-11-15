import React, { memo, useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type GestureResponderEvent } from "react-native";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { mutedIconColorMapping } from "@/components/ui/icon-color";
import { ComposerTrackMark } from "@/composer/tracks";
import { useCompactTimeAgo } from "@/hooks/use-compact-time-ago";
import { summarizeSubthreads, type SubthreadRow } from "@/subthreads/model";
import { useMiddleClickOpensTab, wantsTabInstead } from "@/subthreads/peek-intent";
import { groupSummaryParts, subthreadStateLabel } from "@/subthreads/registry-labels";

const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);

/** Rows shown before "Show N more"; the rest are one tap away. */
export const SPAWNED_AGENTS_VISIBLE = 5;

/**
 * Every unarchived agent this chat spawned, one line each, in the registry's order: the state,
 * the title, the state word and the last activity. A row peeks the agent beside the chat (Mod+
 * click or middle-click on web opens its tab). Provider subagents are not listed: this is the
 * surface for asks and answers, and provider tasks are the inside of a turn.
 *
 * In the floating pane it starts folded to its heading and summary, so an agent an ask already
 * tracks is not shown twice by default. Above the chat's Stream it is open, with its hint.
 */
export const SpawnedAgentsSection = memo(function SpawnedAgentsSection({
  rows,
  collapsed,
  onToggle,
  onPeek,
  onOpenTab,
  onOpenRegistry,
  first = false,
  showHint = false,
  testID = "spawned-agents",
}: {
  rows: readonly SubthreadRow[];
  collapsed: boolean;
  /** Absent: the section cannot fold. */
  onToggle?: () => void;
  onPeek: (row: SubthreadRow) => void;
  onOpenTab: (row: SubthreadRow) => void;
  /** Opens the side panel on its list; absent where there is no panel to open. */
  onOpenRegistry?: () => void;
  /** Directly under a header that already separates it; no top border. */
  first?: boolean;
  /** Explain where the rows come from (the full Stream view; the pane stays terse). */
  showHint?: boolean;
  testID?: string;
}) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  const toggleShowAll = useCallback(() => setShowAll((value) => !value), []);
  const summary = useMemo(() => summarizeSubthreads(rows), [rows]);
  const accessibilityState = useMemo(() => ({ expanded: !collapsed }), [collapsed]);
  if (rows.length === 0) return null;
  const visible = showAll ? rows : rows.slice(0, SPAWNED_AGENTS_VISIBLE);
  const hidden = rows.length - visible.length;
  const parts = groupSummaryParts(t, summary);
  const heading = t("agentPanel.stream.answers.spawned.section", { count: rows.length });
  const Chevron = collapsed ? ThemedChevronRight : ThemedChevronDown;
  const headingContent = (
    <>
      {onToggle ? <Chevron size={12} uniProps={mutedIconColorMapping} /> : null}
      <Text style={styles.label} numberOfLines={1}>
        {heading}
      </Text>
      {parts.length > 0 ? (
        <Text style={styles.summary} numberOfLines={1} testID={`${testID}-summary`}>
          {parts.join(" · ")}
        </Text>
      ) : null}
    </>
  );
  return (
    <View style={[styles.section, !first && styles.sectionBorder]} testID={testID}>
      {onToggle ? (
        <Pressable
          onPress={onToggle}
          accessibilityRole="button"
          accessibilityLabel={[heading, ...parts].join(", ")}
          accessibilityState={accessibilityState}
          aria-expanded={!collapsed}
          hitSlop={6}
          style={styles.heading}
          testID={`${testID}-toggle`}
        >
          {headingContent}
        </Pressable>
      ) : (
        <View style={styles.heading} accessibilityRole="header">
          {headingContent}
        </View>
      )}
      {collapsed ? null : (
        <>
          {showHint ? (
            <Text style={styles.hint}>{t("agentPanel.stream.answers.spawned.hint")}</Text>
          ) : null}
          {visible.map((row) => (
            <SpawnedAgentRow
              key={row.id}
              row={row}
              testID={testID}
              onPeek={onPeek}
              onOpenTab={onOpenTab}
            />
          ))}
          {hidden > 0 || showAll ? (
            <Pressable
              onPress={toggleShowAll}
              accessibilityRole="button"
              hitSlop={6}
              testID={`${testID}-more`}
            >
              <Text style={styles.link}>
                {showAll
                  ? t("agentPanel.stream.answers.delegation.showFewer")
                  : t("agentPanel.stream.answers.delegation.showMore", { count: hidden })}
              </Text>
            </Pressable>
          ) : null}
          {onOpenRegistry ? (
            <Pressable
              onPress={onOpenRegistry}
              accessibilityRole="button"
              hitSlop={6}
              testID={`${testID}-open-registry`}
            >
              <Text style={styles.link}>{t("agentPanel.stream.answers.spawned.openRegistry")}</Text>
            </Pressable>
          ) : null}
        </>
      )}
    </View>
  );
});

const SpawnedAgentRow = memo(function SpawnedAgentRow({
  row,
  testID,
  onPeek,
  onOpenTab,
}: {
  row: SubthreadRow;
  testID: string;
  onPeek: (row: SubthreadRow) => void;
  onOpenTab: (row: SubthreadRow) => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<View>(null);
  const openTab = useCallback(() => onOpenTab(row), [onOpenTab, row]);
  useMiddleClickOpensTab(ref, openTab);
  const handlePress = useCallback(
    (event: GestureResponderEvent) => (wantsTabInstead(event) ? onOpenTab(row) : onPeek(row)),
    [onOpenTab, onPeek, row],
  );
  const age = useCompactTimeAgo(row.lastActivityAt);
  const title = row.label ?? t("subthreads.untitled");
  const state = subthreadStateLabel(t, row);
  const needsYou = row.needsInput || row.bucket === "failed";
  return (
    <Pressable
      ref={ref}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={[
        title,
        state,
        age ? t("subthreads.card.lastActive", { time: age }) : null,
      ]
        .filter(Boolean)
        .join(", ")}
      accessibilityHint={t("subthreads.openHint")}
      hitSlop={4}
      style={rowStyle}
      testID={`${testID}-row-${row.id}`}
    >
      <View style={styles.mark}>
        <ComposerTrackMark bucket={row.bucket} />
      </View>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <Text
        style={[styles.state, needsYou && styles.stateAttention]}
        numberOfLines={1}
        testID={`${testID}-row-state-${row.id}`}
      >
        {state}
      </Text>
      {age ? <Text style={styles.age}>{age}</Text> : null}
    </Pressable>
  );
});

function rowStyle({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) {
  return [styles.row, pressed || hovered ? styles.rowActive : null];
}

const styles = StyleSheet.create((theme) => ({
  section: {
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[2],
  },
  sectionBorder: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingTop: theme.spacing[1],
    minHeight: 24,
  },
  label: {
    flexShrink: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  summary: {
    flexShrink: 1,
    minWidth: 0,
    marginLeft: theme.spacing[1],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    minHeight: 28,
    paddingHorizontal: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
  },
  rowActive: {
    backgroundColor: theme.colors.interactionHighlight,
  },
  mark: {
    width: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  state: {
    flexShrink: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  stateAttention: {
    color: theme.colors.statusWarning,
  },
  age: {
    flexShrink: 0,
    minWidth: 24,
    textAlign: "right",
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
  },
  link: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textDecorationLine: "underline",
  },
}));
