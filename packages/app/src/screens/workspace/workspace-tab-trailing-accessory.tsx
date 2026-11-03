import { useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { CircleCheck, Ellipsis } from "lucide-react-native";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { WorkspaceTabMenuEntry } from "@/screens/workspace/workspace-tab-menu";
import { renderWorkspaceTabMenuIcon } from "@/screens/workspace/workspace-tab-menu-icon";
import type { Theme } from "@/styles/theme";

const ThemedEllipsis = withUnistyles(Ellipsis);
const ThemedCircleCheck = withUnistyles(CircleCheck);

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function mobileTabMenuTriggerStyle({ open, pressed }: { open?: boolean; pressed?: boolean }) {
  return [
    styles.mobileTabMenuTrigger,
    (Boolean(open) || Boolean(pressed)) && styles.mobileTabMenuTriggerActive,
  ];
}

function MobileTabDropdownMenuItem({
  entry,
}: {
  entry: Extract<WorkspaceTabMenuEntry, { kind: "item" }>;
}) {
  const leading = useMemo(() => {
    return renderWorkspaceTabMenuIcon(entry.icon);
  }, [entry.icon]);
  const trailing = useMemo(
    () => (entry.hint ? <Text style={styles.menuItemHint}>{entry.hint}</Text> : undefined),
    [entry.hint],
  );
  return (
    <DropdownMenuItem
      testID={entry.testID}
      disabled={entry.disabled}
      destructive={entry.destructive}
      onSelect={entry.onSelect}
      tooltip={entry.tooltip}
      leading={leading}
      trailing={trailing}
    >
      {entry.label}
    </DropdownMenuItem>
  );
}

export function MobileTabTrailingAccessory({
  menuTestIDBase,
  presentationLabel,
  menuEntries,
  onMarkRead,
}: {
  menuTestIDBase: string;
  presentationLabel: string;
  menuEntries: WorkspaceTabMenuEntry[];
  /** Shown as a check beside the menu while the tab has something to read. */
  onMarkRead?: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const markReadLeadingIcon = useMemo(
    () => <ThemedCircleCheck size={16} uniProps={mutedColorMapping} />,
    [],
  );
  const menu = (
    <DropdownMenu compactMode="sheet">
      <DropdownMenuTrigger
        testID={`${menuTestIDBase}-trigger`}
        accessibilityRole="button"
        accessibilityLabel={t("workspace.tabs.menu.openFor", { label: presentationLabel })}
        hitSlop={8}
        style={mobileTabMenuTriggerStyle}
      >
        <ThemedEllipsis size={14} uniProps={mutedColorMapping} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="bottom"
        align="end"
        width={220}
        sheetTitle={presentationLabel}
        testID={menuTestIDBase}
      >
        {onMarkRead ? (
          <>
            <DropdownMenuItem
              testID={`${menuTestIDBase}-mark-as-read-item`}
              leading={markReadLeadingIcon}
              onSelect={onMarkRead}
            >
              {t("workspace.tabs.menu.markAsRead")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        {menuEntries.map((entry) =>
          entry.kind === "separator" ? (
            <DropdownMenuSeparator key={entry.key} />
          ) : (
            <MobileTabDropdownMenuItem key={entry.key} entry={entry} />
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
  if (!onMarkRead) return menu;
  return (
    <View style={styles.mobileTabTrailingRow}>
      <Pressable
        testID={`${menuTestIDBase}-mark-as-read`}
        accessibilityRole="button"
        accessibilityLabel={t("workspace.tabs.menu.markAsReadNamed", { name: presentationLabel })}
        hitSlop={8}
        onPress={onMarkRead}
        style={mobileTabMenuTriggerStyle}
      >
        <ThemedCircleCheck size={14} uniProps={mutedColorMapping} />
      </Pressable>
      {menu}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  mobileTabMenuTrigger: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  mobileTabTrailingRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  mobileTabMenuTriggerActive: {
    backgroundColor: theme.colors.surface2,
  },
  menuItemHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
