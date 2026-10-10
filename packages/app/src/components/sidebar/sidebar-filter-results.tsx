import React, { memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Pressable,
  Text,
  View,
  type PressableStateCallbackType,
  type StyleProp,
  type TextStyle,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { getProviderIcon } from "@/components/provider-icons";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { SidebarFilterEmptyState } from "@/components/sidebar/empty-states";
import { isWeb } from "@/constants/platform";
import { useSessionStore } from "@/stores/session-store";
import type { Theme } from "@/styles/theme";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { formatCompactTimeAgo } from "@/utils/time";
import {
  selectNestedTabMatches,
  splitSidebarMatch,
  trimSidebarSnippetLead,
  type SidebarMatchRange,
  type SidebarMessageHit,
  type SidebarTabMatch,
} from "./sidebar-filter-matches";
import {
  useSidebarMessageSearchState,
  useSidebarWorkspaceTabMatches,
} from "./sidebar-filter-context";

/**
 * The sidebar filter's "why it matched" rows (docs/sidebar-filter.md): tab-title matches nested
 * under their workspace row, and the "In messages" group below the tree.
 */

const NESTED_TAB_LIMIT = 3;

const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

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
  return <Icon size={12} color={color ?? "currentColor"} />;
}

const ThemedProviderGlyph = withUnistyles(ProviderGlyph);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);

function HighlightedText({
  text,
  range,
  style,
  matchStyle,
}: {
  text: string;
  range: SidebarMatchRange | null;
  style: StyleProp<TextStyle>;
  matchStyle: StyleProp<TextStyle>;
}) {
  const parts = useMemo(() => splitSidebarMatch(text, range), [text, range]);
  return (
    <Text style={style} numberOfLines={1}>
      {parts.before}
      {parts.match ? <Text style={matchStyle}>{parts.match}</Text> : null}
      {parts.after}
    </Text>
  );
}

function rowStyle({
  hovered = false,
  pressed,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.row, hovered && !pressed && styles.rowHovered, pressed && styles.rowPressed];
}

const NestedTabRow = memo(function NestedTabRow({
  match,
  onNavigate,
}: {
  match: SidebarTabMatch;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => {
    onNavigate?.();
    navigateToAgent({
      serverId: match.serverId,
      agentId: match.agentId,
      workspaceId: match.workspaceId,
    });
  }, [match.agentId, match.serverId, match.workspaceId, onNavigate]);
  return (
    <Pressable
      accessibilityRole={isWeb ? undefined : "button"}
      accessibilityLabel={t("sidebar.filterSidebar.matches.openTab", { title: match.title })}
      onPress={handlePress}
      style={rowStyle}
      testID={`sidebar-filter-tab-match-${match.serverId}-${match.agentId}`}
    >
      <View style={styles.iconSlot}>
        <ThemedProviderGlyph
          provider={match.provider}
          serverId={match.serverId}
          uniProps={foregroundMutedColorMapping}
        />
      </View>
      <HighlightedText
        text={match.title}
        range={match.range}
        style={styles.tabTitle}
        matchStyle={styles.match}
      />
    </Pressable>
  );
});

/**
 * Tab-title matches for one workspace row, rendered directly beneath it. Renders nothing unless
 * the live filter matched one of the workspace's tabs, so it costs one context read per row.
 */
export function SidebarWorkspaceTabMatches({
  workspaceKey,
  workspace,
  onNavigate,
}: {
  workspaceKey: string;
  workspace: { title: string | null; name: string } | null;
  onNavigate?: () => void;
}) {
  const allMatches = useSidebarWorkspaceTabMatches(workspaceKey);
  const matches = useMemo(
    () => selectNestedTabMatches(allMatches, workspace),
    [allMatches, workspace],
  );
  if (matches.length === 0) return null;
  return <NestedTabList matches={matches} onNavigate={onNavigate} workspaceKey={workspaceKey} />;
}

function NestedTabList({
  matches,
  onNavigate,
  workspaceKey,
}: {
  matches: readonly SidebarTabMatch[];
  onNavigate?: () => void;
  workspaceKey: string;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((value) => !value), []);
  const hidden = matches.length - NESTED_TAB_LIMIT;
  const visible = expanded || hidden <= 0 ? matches : matches.slice(0, NESTED_TAB_LIMIT);
  return (
    <View testID={`sidebar-filter-tab-matches-${workspaceKey}`}>
      {visible.map((match) => (
        <NestedTabRow
          key={`${match.serverId}:${match.agentId}`}
          match={match}
          onNavigate={onNavigate}
        />
      ))}
      {hidden > 0 ? (
        <Pressable
          accessibilityRole={isWeb ? undefined : "button"}
          onPress={toggle}
          style={rowStyle}
          testID={`sidebar-filter-tab-matches-toggle-${workspaceKey}`}
        >
          <View style={styles.iconSlot} />
          <Text style={styles.toggleText}>
            {expanded
              ? t("sidebar.filterSidebar.matches.fewerTabs")
              : t("sidebar.filterSidebar.matches.moreTabs", { count: hidden })}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const MessageHitRow = memo(function MessageHitRow({
  hit,
  onNavigate,
}: {
  hit: SidebarMessageHit;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  // The host's directory carries renames made after the scan read its record.
  const liveTitle = useSessionStore(
    (state) => state.sessions[hit.serverId]?.agents.get(hit.agentId)?.title ?? null,
  );
  const title = liveTitle || hit.title;
  const snippet = useMemo(() => trimSidebarSnippetLead(hit), [hit]);
  const time = hit.timestamp ? formatCompactTimeAgo(new Date(hit.timestamp)) : null;
  const breadcrumb =
    hit.workspaceTitle && hit.workspaceTitle !== title
      ? `${hit.projectName} · ${hit.workspaceTitle}`
      : hit.projectName;
  const handlePress = useCallback(() => {
    onNavigate?.();
    navigateToAgent({ serverId: hit.serverId, agentId: hit.agentId, workspaceId: hit.workspaceId });
  }, [hit.agentId, hit.serverId, hit.workspaceId, onNavigate]);
  return (
    <Pressable
      accessibilityRole={isWeb ? undefined : "button"}
      accessibilityLabel={t("sidebar.filterSidebar.matches.openMessage", {
        title,
        snippet: hit.snippet,
      })}
      onPress={handlePress}
      style={messageRowStyle}
      testID={`sidebar-filter-message-match-${hit.serverId}-${hit.agentId}`}
    >
      <View style={styles.messageHeader}>
        <View style={styles.iconSlot}>
          <ThemedProviderGlyph
            provider={hit.provider}
            serverId={hit.serverId}
            uniProps={foregroundMutedColorMapping}
          />
        </View>
        <Text style={styles.messageTitle} numberOfLines={1}>
          {title}
        </Text>
        {time ? <Text style={styles.meta}>{time}</Text> : null}
      </View>
      <Text style={[styles.meta, styles.messageIndent]} numberOfLines={1}>
        {breadcrumb}
      </Text>
      <View style={styles.messageIndent}>
        <HighlightedText
          text={snippet.text}
          range={snippet.range}
          style={styles.snippet}
          matchStyle={styles.match}
        />
      </View>
    </Pressable>
  );
});

function messageRowStyle({
  hovered = false,
  pressed,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [
    styles.messageRow,
    hovered && !pressed && styles.rowHovered,
    pressed && styles.rowPressed,
  ];
}

/**
 * What follows the filtered tree while the sidebar filter is active: the "In messages" group, the
 * empty state once every tier has answered with nothing, and the Enter hint. With no text query it
 * is only the existing label-filter empty state.
 */
export function SidebarFilterResultsTail({
  treeEmpty,
  onNavigate,
}: {
  treeEmpty: boolean;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const search = useSidebarMessageSearchState();
  if (!search.query) return treeEmpty ? <SidebarFilterEmptyState /> : null;
  const searching = search.status === "searching";
  const hasHits = search.hits.length > 0;
  // Shown only when a host stopped at a bound, so "no hits" is not mistaken for "not mentioned".
  const partial = !searching && search.coverage?.truncated === true ? search.coverage : null;
  return (
    <>
      {treeEmpty && !hasHits && !searching ? <SidebarFilterEmptyState /> : null}
      {hasHits || searching || partial ? (
        <View style={styles.messageGroup} testID="sidebar-filter-message-matches">
          <View style={styles.groupHeader}>
            <Text style={styles.groupTitle}>{t("sidebar.filterSidebar.matches.inMessages")}</Text>
            {searching ? (
              <View
                style={styles.searching}
                accessibilityLiveRegion="polite"
                testID="sidebar-filter-message-searching"
              >
                <ThemedLoadingSpinner size={12} uniProps={foregroundMutedColorMapping} />
                <Text style={styles.meta}>{t("sidebar.filterSidebar.matches.searching")}</Text>
              </View>
            ) : null}
          </View>
          {search.hits.map((hit) => (
            <MessageHitRow key={hit.key} hit={hit} onNavigate={onNavigate} />
          ))}
          {partial ? (
            <Text style={styles.coverage} testID="sidebar-filter-message-coverage">
              {t("sidebar.filterSidebar.matches.coverage", {
                searched: partial.searchedCount,
                total: partial.totalCount,
              })}
            </Text>
          ) : null}
        </View>
      ) : null}
      <Text style={styles.enterHint} testID="sidebar-filter-enter-hint">
        {t("sidebar.filterSidebar.matches.enterHint")}
      </Text>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Kept in step with the workspace row's geometry (sidebar-workspace-list.tsx `workspaceRow`),
  // one step denser: these rows are evidence under a row, not rows of their own. The left padding
  // puts the provider glyph on the title rail of the indented workspace row above
  // (row indent + status slot + gap).
  row: {
    minHeight: 28,
    marginBottom: theme.spacing[0.5],
    paddingVertical: theme.spacing[1],
    paddingLeft: theme.spacing[4] + theme.iconSize.sm + theme.spacing[2],
    paddingRight: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    userSelect: "none",
  },
  rowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  rowPressed: {
    backgroundColor: theme.colors.surface2,
  },
  iconSlot: {
    width: theme.iconSize.sm,
    height: theme.iconSize.sm,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  tabTitle: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  match: {
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
  },
  toggleText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  messageGroup: {
    marginTop: theme.spacing[2],
  },
  // Matches the "Workspaces" and "Pinned" section headers above the tree.
  groupHeader: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  groupTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
  searching: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  messageRow: {
    marginBottom: theme.spacing[0.5],
    paddingVertical: theme.spacing[2],
    paddingLeft: theme.spacing[2],
    paddingRight: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    gap: theme.spacing[0.5],
    userSelect: "none",
  },
  messageHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  messageTitle: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  // Secondary lines start on the title's rail, past the provider glyph.
  messageIndent: {
    paddingLeft: theme.iconSize.sm + theme.spacing[2],
  },
  meta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  snippet: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  coverage: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[1],
  },
  enterHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[3],
  },
}));
