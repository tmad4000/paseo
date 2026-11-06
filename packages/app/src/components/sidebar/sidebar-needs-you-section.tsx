import { useCallback, useMemo, useState } from "react";
import { router, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ban, ChevronDown, ChevronRight, CircleHelp, Lock } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { askBlockerReason } from "@getpaseo/protocol/companion-stream";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import { ALL_HOSTS_OPTION_ID } from "@/components/hosts/host-picker";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import type { Theme } from "@/styles/theme";
import { useStreamReturnStore } from "@/companion-stream/stream-return";
import { rowNeedsYouGroup } from "@/companion-stream/needs-you-groups";
import { useNeedsYouRows } from "@/companion-stream/use-needs-you-rows";
import { useNeedsYouSectionStore } from "@/companion-stream/needs-you-section-store";
import type { GlobalStreamRow } from "@/companion-stream/use-global-stream";

const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);
const mutedColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const NEEDS_YOU_HREF = "/stream?view=needs_you" as Href;
// Blocked work, a question, a permission: the same three groups Needs you lists.
const GROUP_ICONS = {
  blocked: withUnistyles(Ban),
  question: withUnistyles(CircleHelp),
  permission: withUnistyles(Lock),
} as const;
const warningColor = (theme: Theme) => ({ color: theme.colors.statusWarning });

/** The headline a row shows: a blocked ask's blocker, otherwise the first line of its text. */
export function needsYouRowHeadline(row: GlobalStreamRow): string {
  if (row.item.kind !== "entry") return row.item.artifact.path;
  const entry = row.item.entry;
  if (entry.ask?.state === "blocked") {
    const reason = askBlockerReason(entry.ask.remaining);
    if (reason) return reason;
  }
  return askBlockerReason(entry.text) || entry.text;
}

/**
 * A pinned top-of-sidebar copy of Needs you's first few items, in One list and Project grouping.
 * Same query and same count as the Needs you screen; hidden when nothing waits. The full inbox
 * stays one tap away.
 */
export function SidebarNeedsYouSection({ onNavigate }: { onNavigate?: () => void }) {
  const enabled = useNeedsYouSectionStore((state) => state.enabled);
  if (!enabled) return null;
  return <NeedsYouSectionBody onNavigate={onNavigate} />;
}

function NeedsYouSectionBody({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  const compact = useIsCompactFormFactor();
  const limit = compact ? 3 : 5;
  const collapsed = useNeedsYouSectionStore((state) => state.collapsed);
  const toggleCollapsed = useNeedsYouSectionStore((state) => state.toggleCollapsed);
  const { rows, count, partial, refetch } = useNeedsYouRows({ limit, enabled: true });
  const openNeedsYou = useCallback(() => {
    onNavigate?.();
    router.navigate(NEEDS_YOU_HREF);
  }, [onNavigate]);
  const headerState = useMemo(() => ({ expanded: !collapsed }), [collapsed]);
  if (count === 0) return null;
  const more = count - rows.length;
  const Chevron = collapsed ? ThemedChevronRight : ThemedChevronDown;
  const countLabel = `${count}${partial ? "+" : ""}`;
  return (
    <View style={styles.section} testID="sidebar-needs-you-section">
      <Pressable
        accessibilityRole="button"
        accessibilityState={headerState}
        onPress={toggleCollapsed}
        style={styles.header}
        testID="sidebar-needs-you-section-header"
      >
        <Chevron size={12} uniProps={mutedColor} />
        <Text style={styles.title}>{t("sidebar.needsYou.title", { count: countLabel })}</Text>
      </Pressable>
      {collapsed ? null : (
        <>
          {rows.map((row) => (
            <NeedsYouSectionRow
              key={JSON.stringify([row.serverId, row.id])}
              row={row}
              onNavigate={onNavigate}
              onOpenNeedsYou={openNeedsYou}
              onChanged={refetch}
            />
          ))}
          {more > 0 || partial ? (
            <Pressable
              accessibilityRole="link"
              onPress={openNeedsYou}
              style={styles.more}
              testID="sidebar-needs-you-section-more"
            >
              <Text style={styles.moreText}>
                {t("sidebar.needsYou.more", { count: `${more}${partial ? "+" : ""}` })}
              </Text>
            </Pressable>
          ) : null}
        </>
      )}
    </View>
  );
}

function NeedsYouSectionRow({
  row,
  onNavigate,
  onOpenNeedsYou,
  onChanged,
}: {
  row: GlobalStreamRow;
  onNavigate?: () => void;
  onOpenNeedsYou: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const handlePointerEnter = useCallback(() => setHovered(true), []);
  const handlePointerLeave = useCallback(() => setHovered(false), []);
  const supportsDefer = useSessionStore(
    (state) => state.sessions[row.serverId]?.serverInfo?.features?.streamDefer === true,
  );
  const setStreamReturn = useStreamReturnStore((state) => state.setTarget);
  const entryId = row.item.kind === "entry" ? row.item.entry.id : null;
  const openChat = useCallback(() => {
    onNavigate?.();
    setStreamReturn({
      serverId: row.serverId,
      agentId: row.agentId,
      place: {
        view: "needs_you",
        showLater: false,
        search: "",
        host: ALL_HOSTS_OPTION_ID,
        scrollOffset: 0,
      },
    });
    navigateToAgent({
      serverId: row.serverId,
      agentId: row.agentId,
      workspaceId: row.workspaceId,
    });
  }, [onNavigate, setStreamReturn, row.serverId, row.agentId, row.workspaceId]);
  const later = useCallback(() => {
    const client = getHostRuntimeStore().getClient(row.serverId);
    if (!client || !entryId) return;
    void client
      .updateStreamEntry({
        agentId: row.agentId,
        entryId,
        action: "set_deferred",
        deferred: true,
      })
      .then(onChanged)
      .catch(() => undefined);
  }, [row.serverId, row.agentId, entryId, onChanged]);
  // Touch has no hover, so the actions stay reachable through Needs you itself.
  const showActions = hovered && !isNative;
  const group = rowNeedsYouGroup(row);
  const GroupIcon = GROUP_ICONS[group];
  return (
    <View
      style={styles.rowHoverTarget}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      testID={`sidebar-needs-you-row-${row.agentId}`}
    >
      <Pressable
        accessibilityRole="button"
        onPress={openChat}
        style={styles.row}
        testID="sidebar-needs-you-row"
      >
        <View style={styles.glyph} accessibilityLabel={t(`sidebar.needsYou.${group}`)}>
          <GroupIcon size={12} uniProps={group === "blocked" ? warningColor : mutedColor} />
        </View>
        <Text style={styles.headline} numberOfLines={1}>
          {needsYouRowHeadline(row)}
        </Text>
        {showActions ? (
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              onPress={onOpenNeedsYou}
              style={styles.action}
              testID="sidebar-needs-you-reply"
            >
              <Text style={styles.actionText}>{t("agentPanel.stream.reply")}</Text>
            </Pressable>
            {supportsDefer && entryId ? (
              <Pressable
                accessibilityRole="button"
                onPress={later}
                style={styles.action}
                testID="sidebar-needs-you-later"
              >
                <Text style={styles.actionText}>{t("agentPanel.stream.later")}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <Text style={styles.meta} numberOfLines={1}>
            {row.agentTitle}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  section: {
    paddingHorizontal: theme.spacing[2],
    paddingBottom: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    marginBottom: theme.spacing[1],
  },
  header: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    userSelect: "none",
  },
  title: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  rowHoverTarget: { position: "relative" },
  row: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  glyph: { width: 16, alignItems: "center" },
  headline: { flex: 1, color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  meta: { maxWidth: "40%", color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  actions: { flexDirection: "row", gap: theme.spacing[1] },
  action: { paddingHorizontal: theme.spacing[1], paddingVertical: 2 },
  actionText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  more: { paddingHorizontal: theme.spacing[2], paddingVertical: theme.spacing[1] },
  moreText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
