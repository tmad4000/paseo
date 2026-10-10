import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ListFilter } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useHostFeatureMap } from "@/runtime/host-features";
import { useSidebarViewStore, type SidebarFilterScope } from "@/stores/sidebar-view-store";
import type { Theme } from "@/styles/theme";
import { useSidebarModel } from "./sidebar-model";

const ThemedListFilter = withUnistyles(ListFilter);
const mutedColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const accentColor = (theme: Theme) => ({ color: theme.colors.foreground });

const SCOPES: readonly SidebarFilterScope[] = ["names", "messages"];

/**
 * What the sidebar find field searches: Names (projects, workspaces, tab titles) or Names +
 * messages. Sits beside the sort trigger. When no host in the sidebar can search messages, the
 * messages item says so instead of failing; the choice is kept for when a host updates.
 */
export function SidebarFilterScopeMenu() {
  const { t } = useTranslation();
  const filterScope = useSidebarViewStore((state) => state.filterScope);
  const setFilterScope = useSidebarViewStore((state) => state.setFilterScope);
  const { serverIds } = useSidebarModel();
  const support = useHostFeatureMap(serverIds, "sessionTextSearch");
  const anyHostSearchesMessages = useMemo(
    () => serverIds.some((serverId) => support.get(serverId) === true),
    [serverIds, support],
  );
  const label = t(`sidebar.filterSidebar.matches.scope.${filterScope}`);
  return (
    <DropdownMenu compactMode="sheet">
      <DropdownMenuTrigger
        style={styles.trigger}
        accessibilityRole="button"
        accessibilityLabel={t("sidebar.filterSidebar.matches.scope.trigger", { value: label })}
        testID="sidebar-filter-scope-trigger"
      >
        <ThemedListFilter
          size={14}
          uniProps={filterScope === "messages" ? accentColor : mutedColor}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        width={280}
        sheetTitle={t("sidebar.filterSidebar.matches.scope.heading")}
      >
        {SCOPES.map((scope) => (
          <ScopeItem
            key={scope}
            scope={scope}
            selected={filterScope === scope}
            needsHostUpdate={scope === "messages" && !anyHostSearchesMessages}
            onSelectScope={setFilterScope}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ScopeItem({
  scope,
  selected,
  needsHostUpdate,
  onSelectScope,
}: {
  scope: SidebarFilterScope;
  selected: boolean;
  needsHostUpdate: boolean;
  onSelectScope: (scope: SidebarFilterScope) => void;
}) {
  const { t } = useTranslation();
  const select = useCallback(() => onSelectScope(scope), [onSelectScope, scope]);
  return (
    <DropdownMenuItem
      selected={selected}
      showSelectedCheck
      description={
        needsHostUpdate
          ? t("sidebar.filterSidebar.matches.scope.needsHostUpdate")
          : t(`sidebar.filterSidebar.matches.scope.${scope}Description`)
      }
      onSelect={select}
      testID={`sidebar-filter-scope-${scope}`}
    >
      {t(`sidebar.filterSidebar.matches.scope.${scope}`)}
    </DropdownMenuItem>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Matches the sort trigger beside it (left-sidebar.tsx `sidebarSortTrigger`).
  trigger: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
}));
