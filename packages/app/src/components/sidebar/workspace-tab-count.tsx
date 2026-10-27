import { useCallback } from "react";
import { Text, View } from "react-native";
import { Copy } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  collectAllPanes,
  collectAllTabs,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-actions";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import type { Theme } from "@/styles/theme";

const TabsIcon = withUnistyles(Copy);
const iconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function countSidebarWorkspaceTabs(layout: WorkspaceLayout | undefined): number {
  if (!layout) return 0;
  const visibleTabIds = new Set(collectAllPanes(layout.root).flatMap((pane) => pane.tabIds));
  return collectAllTabs(layout.root).filter(
    (tab) => visibleTabIds.has(tab.tabId) && tab.target.kind !== "new_tab",
  ).length;
}

export function WorkspaceTabCount({ workspaceKey }: { workspaceKey: string }) {
  // Subscribe to the count alone: focus, streaming and tab-state changes don't repaint the row.
  const count = useWorkspaceLayoutStore(
    useCallback(
      (state) => countSidebarWorkspaceTabs(state.layoutByWorkspace[workspaceKey]),
      [workspaceKey],
    ),
  );
  const { t } = useTranslation();
  if (count < 2) return null;
  const label = t("sidebar.openTabs", { count });
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <View style={styles.badge} accessible accessibilityLabel={label} accessibilityRole="text">
          <TabsIcon size={12} uniProps={iconColor} />
          <Text style={styles.count} testID="sidebar-workspace-tab-count">
            {count}
          </Text>
        </View>
      </TooltipTrigger>
      <TooltipContent>
        <Text style={styles.tooltip}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
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
}));
