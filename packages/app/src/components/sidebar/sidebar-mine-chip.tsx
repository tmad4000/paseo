import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import { useSidebarModel } from "./sidebar-model";

type ChipState = PressableStateCallbackType & { hovered?: boolean };

/**
 * One tap between every workspace and only the ones a person started or talked to. While on, the
 * chip says how many workspaces it is hiding, so a quiet sidebar never looks like missing work.
 * The same flag backs the Command Center's "Show only my sessions" action.
 */
export function SidebarMineChip() {
  const { t } = useTranslation();
  const mineOnly = useSidebarViewStore((state) => state.mineOnly);
  const toggleMineOnly = useSidebarViewStore((state) => state.toggleMineOnly);
  const { mineHiddenCount } = useSidebarModel();
  const tooltip = mineOnly
    ? t("sidebar.filterSidebar.mine.showAll", { count: mineHiddenCount })
    : t("sidebar.filterSidebar.mine.showMine");
  const accessibilityState = useMemo(() => ({ selected: mineOnly }), [mineOnly]);
  const chipStyle = useCallback(
    ({ hovered = false, pressed }: ChipState) => [
      styles.chip,
      (mineOnly || hovered || pressed) && styles.chipHighlighted,
    ],
    [mineOnly],
  );
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <Pressable
          onPress={toggleMineOnly}
          accessibilityRole="button"
          accessibilityState={accessibilityState}
          accessibilityLabel={tooltip}
          style={chipStyle}
          testID="sidebar-mine-filter"
        >
          <Text style={mineOnly ? styles.labelActive : styles.label} numberOfLines={1}>
            {t("sidebar.filterSidebar.mine.label")}
          </Text>
          {mineOnly && mineHiddenCount > 0 ? (
            <Text style={styles.count} numberOfLines={1} testID="sidebar-mine-filter-count">
              {mineHiddenCount}
            </Text>
          ) : null}
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="center" offset={8} testID="sidebar-mine-filter-tooltip">
        <Text style={styles.tooltipText}>{tooltip}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Same height and radius as the scope and sort triggers beside it.
  chip: {
    height: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    flexShrink: 0,
    userSelect: "none",
  },
  chipHighlighted: {
    backgroundColor: theme.colors.interactionHighlight,
  },
  label: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  labelActive: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  count: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    fontVariant: ["tabular-nums"],
  },
  tooltipText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.popoverForeground,
  },
}));
