import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Clock } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AgentStatusDot } from "@/components/agent-status-dot";
import { getCommandCenterIcon } from "@/command-center/icon";
import { getProviderIcon } from "@/components/provider-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuHint,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { iconButtonChromeStyle } from "@/components/ui/icon-button-chrome";
import { Shortcut } from "@/components/ui/shortcut";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { RECENT_SESSIONS_MENU_LIMIT, type RecentSessionRow } from "@/navigation/recent-sessions";
import { useRecentSessionRows } from "@/navigation/use-recent-session-rows";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { useRecentVisitsStore } from "@/stores/recent-visits-store";
import type { Theme } from "@/styles/theme";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { formatTimeAgo } from "@/utils/time";

const ThemedClock = withUnistyles(Clock);
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function triggerStyle({
  hovered,
  pressed,
  open,
}: {
  hovered: boolean;
  pressed: boolean;
  open: boolean;
}) {
  return iconButtonChromeStyle({ size: "large", state: { hovered, pressed, open } });
}

export function openRecentSessionsInCommandCenter(): void {
  useKeyboardShortcutsStore.getState().setCommandCenterOpen(true, "recent");
}

function RecentSessionItem({ row }: { row: RecentSessionRow }) {
  const { t } = useTranslation();
  // Cached per provider, themed to the muted foreground.
  const ProviderIcon = getCommandCenterIcon(getProviderIcon(row.provider, row.serverId));
  const leading = useMemo(() => <ProviderIcon size={16} />, [ProviderIcon]);
  const trailing = useMemo(
    () => (
      <AgentStatusDot
        status={row.status}
        requiresAttention={row.requiresAttention}
        attentionReason={row.attentionReason}
        pendingPermissionCount={row.pendingPermissionCount}
      />
    ),
    [row.attentionReason, row.pendingPermissionCount, row.requiresAttention, row.status],
  );
  const handleSelect = useCallback(() => {
    navigateToAgent({ serverId: row.serverId, agentId: row.agentId });
  }, [row.agentId, row.serverId]);
  const description = [row.breadcrumb, formatTimeAgo(new Date(row.visitedAt))]
    .filter(Boolean)
    .join(" · ");

  return (
    <DropdownMenuItem
      testID={`recent-sessions-item-${row.key}`}
      leading={leading}
      trailing={trailing}
      description={description}
      onSelect={handleSelect}
    >
      {row.title || t("shell.commandCenter.newAgent")}
    </DropdownMenuItem>
  );
}

/** Mounted only while the menu is open, so the session-store subscription is too. */
function RecentSessionsMenuItems() {
  const { t } = useTranslation();
  const rows = useRecentSessionRows(RECENT_SESSIONS_MENU_LIMIT);
  return (
    <>
      {rows.length === 0 ? (
        <DropdownMenuHint>{t("shell.recentSessions.empty")}</DropdownMenuHint>
      ) : (
        rows.map((row) => <RecentSessionItem key={row.key} row={row} />)
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        testID="recent-sessions-show-all"
        onSelect={openRecentSessionsInCommandCenter}
      >
        {t("shell.recentSessions.showAll")}
      </DropdownMenuItem>
    </>
  );
}

/**
 * Header button listing the sessions you most recently looked at. Phones only show it
 * once there is something to list, since their header has little room.
 */
export function RecentSessionsButton() {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const hasRecentSessions = useRecentVisitsStore((state) =>
    state.visits.some((visit) => visit.agentId !== null),
  );
  const shortcutKeys = useShortcutKeys("recent-sessions");
  const label = t("shell.recentSessions.title");

  if (isCompact && !hasRecentSessions) {
    return null;
  }
  return (
    <DropdownMenu compactMode="sheet">
      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger
            testID="recent-sessions-button"
            accessibilityRole="button"
            accessibilityLabel={label}
            style={triggerStyle}
          >
            {({ hovered, open }) => (
              <ThemedClock
                size={16}
                uniProps={hovered || open ? foregroundColorMapping : mutedColorMapping}
              />
            )}
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="center" offset={8}>
          <View style={styles.tooltipRow}>
            <Text style={styles.tooltipText}>{label}</Text>
            {shortcutKeys && !isCompact ? <Shortcut chord={shortcutKeys} /> : null}
          </View>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="start"
        minWidth={300}
        maxWidth={420}
        sheetTitle={label}
        testID="recent-sessions-menu"
      >
        <RecentSessionsMenuItems />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const styles = StyleSheet.create((theme) => ({
  tooltipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  tooltipText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.popoverForeground,
  },
}));
