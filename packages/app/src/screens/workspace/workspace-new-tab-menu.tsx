import { useCallback, useMemo, type ComponentType, type ReactElement } from "react";
import { View } from "react-native";
import { Columns2, Rows2 } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { withUnistyles } from "react-native-unistyles";
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Shortcut } from "@/components/ui/shortcut";
import { TerminalProfileIcon } from "@/components/terminal-profile-icon";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import type { Theme } from "@/styles/theme";
import {
  useWorkspaceTabLaunchCatalog,
  type WorkspaceTabLaunchItem,
  type WorkspaceTabLaunchPurpose,
} from "@/workspace-tabs/launcher";
import type { PaneHost } from "@/panels/panel-manifest";
import type { PanelIconProps } from "@/panels/panel-registry";

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function LaunchItemIconGlyph({
  Icon,
  color = "",
}: {
  Icon: ComponentType<PanelIconProps>;
  color?: string;
}) {
  return <Icon size={14} color={color} />;
}

const ThemedLaunchItemIconGlyph = withUnistyles(LaunchItemIconGlyph);
const ThemedColumns2 = withUnistyles(Columns2);
const ThemedRows2 = withUnistyles(Rows2);

function LaunchItemIcon({ item }: { item: WorkspaceTabLaunchItem }): ReactElement | null {
  if (item.Icon) {
    return <ThemedLaunchItemIconGlyph Icon={item.Icon} uniProps={mutedColorMapping} />;
  }
  if (item.terminalIconKey) {
    return (
      <View>
        <TerminalProfileIcon iconKey={item.terminalIconKey} size={14} />
      </View>
    );
  }
  return null;
}

function WorkspaceNewTabMenuItem({
  item,
  paneId,
}: {
  item: WorkspaceTabLaunchItem;
  paneId?: string;
}) {
  const leading = useMemo(() => <LaunchItemIcon item={item} />, [item]);
  const trailing = useMemo(
    () =>
      item.shortcutActionId ? <LaunchItemShortcut actionId={item.shortcutActionId} /> : undefined,
    [item.shortcutActionId],
  );
  const handleSelect = useCallback(() => item.launch({ kind: "open", paneId }), [item, paneId]);

  return (
    <DropdownMenuItem
      testID={`workspace-new-tab-menu-${item.id}`}
      leading={leading}
      trailing={trailing}
      disabled={item.disabled}
      onSelect={handleSelect}
    >
      {item.label}
    </DropdownMenuItem>
  );
}

function LaunchItemShortcut({ actionId }: { actionId: string }) {
  const keys = useShortcutKeys(actionId);
  return keys ? <Shortcut chord={keys} /> : null;
}

/**
 * Split right / Split down at the foot of the New Tab menu, so a plain click on + offers a split.
 * Hovering, right-clicking or long-pressing + offers the same two choices on their own
 * (new-tab-split-preview.tsx); this keeps them reachable for people who just click.
 */
function NewTabMenuSplitItems({
  onSplitRight,
  onSplitDown,
}: {
  onSplitRight: () => void;
  onSplitDown: () => void;
}) {
  const { t } = useTranslation();
  const splitRightLeading = useMemo(
    () => <ThemedColumns2 size={14} uniProps={mutedColorMapping} />,
    [],
  );
  const splitDownLeading = useMemo(
    () => <ThemedRows2 size={14} uniProps={mutedColorMapping} />,
    [],
  );
  const splitRightTrailing = useMemo(
    () => <LaunchItemShortcut actionId="workspace-pane-split-right" />,
    [],
  );
  const splitDownTrailing = useMemo(
    () => <LaunchItemShortcut actionId="workspace-pane-split-down" />,
    [],
  );
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        testID="workspace-new-tab-menu-split-right"
        leading={splitRightLeading}
        trailing={splitRightTrailing}
        onSelect={onSplitRight}
      >
        {t("workspace.tabs.actions.splitRight")}
      </DropdownMenuItem>
      <DropdownMenuItem
        testID="workspace-new-tab-menu-split-down"
        leading={splitDownLeading}
        trailing={splitDownTrailing}
        onSelect={onSplitDown}
      >
        {t("workspace.tabs.actions.splitDown")}
      </DropdownMenuItem>
    </>
  );
}

export function WorkspaceNewTabMenuContent({
  serverId,
  purpose,
  host,
  paneId,
  onSplitRight,
  onSplitDown,
}: {
  serverId: string;
  purpose: WorkspaceTabLaunchPurpose;
  host: PaneHost;
  paneId?: string;
  /** When both are given, the menu ends with Split pane right / Split pane down. */
  onSplitRight?: () => void;
  onSplitDown?: () => void;
}) {
  const groups = useWorkspaceTabLaunchCatalog({ serverId, purpose, host });

  return (
    <DropdownMenuContent
      side="bottom"
      align="start"
      offset={4}
      minWidth={200}
      testID="workspace-new-tab-menu"
    >
      {groups.map((group, index) => (
        <View key={group.id}>
          {index > 0 ? <DropdownMenuSeparator /> : null}
          {group.label ? <DropdownMenuLabel>{group.label}</DropdownMenuLabel> : null}
          {group.items.map((item) => (
            <WorkspaceNewTabMenuItem key={item.id} item={item} paneId={paneId} />
          ))}
          {group.accessory ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                testID={`workspace-new-tab-menu-${group.accessory.id}`}
                onSelect={group.accessory.run}
              >
                {group.accessory.label}
              </DropdownMenuItem>
            </>
          ) : null}
        </View>
      ))}
      {onSplitRight && onSplitDown ? (
        <NewTabMenuSplitItems onSplitRight={onSplitRight} onSplitDown={onSplitDown} />
      ) : null}
    </DropdownMenuContent>
  );
}
