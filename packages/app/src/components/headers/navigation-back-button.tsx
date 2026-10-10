import { useCallback, useMemo } from "react";
import type { GestureResponderEvent } from "react-native";
import { ArrowLeft, ArrowRight } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { withUnistyles } from "react-native-unistyles";
import { HeaderToggleButton } from "./header-toggle-button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  useContextMenu,
} from "@/components/ui/context-menu";
import { useIsCompactFormFactor } from "@/constants/layout";
import {
  navigateInFocusHistory,
  useCanNavigateBackInFocusHistory,
  useCanNavigateForwardInFocusHistory,
  useFocusHistoryEntries,
} from "@/navigation/focus-history-runtime";
import type { NavigationFocusHistoryDirection } from "@/navigation/focus-history";
import { describeFocusLocation, type FocusLocationLabel } from "@/navigation/focus-history-labels";
import { useSessionStore } from "@/stores/session-store";
import { selectWorkspace } from "@/stores/session-store-hooks/selectors";
import type { ShortcutKey } from "@/utils/format-shortcut";
import type { Theme } from "@/styles/theme";

const ThemedArrowLeft = withUnistyles(ArrowLeft);
const ThemedArrowRight = withUnistyles(ArrowRight);
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const extraMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundExtraMuted });

const DIRECTIONS = {
  back: {
    testID: "navigation-back-button",
    labelKey: "common.actions.navigateBack",
    shortcutKeys: ["mod", "alt", "ArrowLeft"],
    Icon: ThemedArrowLeft,
  },
  forward: {
    testID: "navigation-forward-button",
    labelKey: "common.actions.navigateForward",
    shortcutKeys: ["mod", "alt", "ArrowRight"],
    Icon: ThemedArrowRight,
  },
} as const satisfies Record<
  NavigationFocusHistoryDirection,
  {
    testID: string;
    labelKey: string;
    shortcutKeys: readonly ShortcutKey[];
    Icon: typeof ThemedArrowLeft;
  }
>;

const MAX_HISTORY_MENU_ENTRIES = 15;

/** Rows for the history menu, labelled from whatever the session store knows right now. */
function NavigationHistoryMenuItems({ direction }: { direction: NavigationFocusHistoryDirection }) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const entries = useFocusHistoryEntries(direction);
  const rows = useMemo(() => {
    const sessions = useSessionStore.getState();
    const deps = {
      t: (key: string) => t(key),
      workspaceTitle: (serverId: string, workspaceId: string) => {
        const workspace = selectWorkspace(sessions, serverId, workspaceId);
        return workspace ? (workspace.title ?? workspace.name) : null;
      },
      agentTitle: (serverId: string, agentId: string) =>
        sessions.sessions[serverId]?.agents.get(agentId)?.title ?? null,
    };
    return entries
      .slice(0, MAX_HISTORY_MENU_ENTRIES)
      .map((location) => describeFocusLocation(location, deps));
  }, [entries, t]);

  return rows.map((row, index) => (
    <NavigationHistoryMenuItem
      // Positions are the identity here: the same place can appear twice in history.
      // oxlint-disable-next-line react/no-array-index-key
      key={index}
      direction={direction}
      steps={index + 1}
      isCompact={isCompact}
      label={row}
    />
  ));
}

function NavigationHistoryMenuItem({
  direction,
  steps,
  isCompact,
  label,
}: {
  direction: NavigationFocusHistoryDirection;
  steps: number;
  isCompact: boolean;
  label: FocusLocationLabel;
}) {
  const handleSelect = useCallback(() => {
    navigateInFocusHistory(direction, { isCompact, steps });
  }, [direction, isCompact, steps]);
  return (
    <ContextMenuItem
      testID={`navigation-${direction}-history-item-${steps - 1}`}
      description={label.subtitle ?? undefined}
      onSelect={handleSelect}
    >
      {label.title}
    </ContextMenuItem>
  );
}

function NavigationHistoryButton({
  direction,
  available,
}: {
  direction: NavigationFocusHistoryDirection;
  available: boolean;
}) {
  const { t } = useTranslation();
  const { testID, labelKey } = DIRECTIONS[direction];

  // Right-click or long-press lists the history in that direction, as a browser's
  // Back button does.
  return (
    <ContextMenu>
      <ContextMenuTrigger contextOnly enabled={available} testID={`${testID}-history-trigger`}>
        <NavigationHistoryPressable direction={direction} available={available} />
      </ContextMenuTrigger>
      <ContextMenuContent
        align="start"
        minWidth={240}
        maxWidth={360}
        sheetTitle={t(labelKey)}
        testID={`${testID}-history`}
      >
        <NavigationHistoryMenuItems direction={direction} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function NavigationHistoryPressable({
  direction,
  available,
}: {
  direction: NavigationFocusHistoryDirection;
  available: boolean;
}) {
  const { t } = useTranslation();
  const menu = useContextMenu();
  const isCompact = useIsCompactFormFactor();
  const { testID, labelKey, shortcutKeys, Icon } = DIRECTIONS[direction];
  const tooltipKeys = useMemo<ShortcutKey[]>(
    () => (isCompact ? [] : [...shortcutKeys]),
    [isCompact, shortcutKeys],
  );
  const accessibilityState = useMemo(() => ({ disabled: !available }), [available]);
  const handlePress = useCallback(() => {
    navigateInFocusHistory(direction, { isCompact });
  }, [direction, isCompact]);
  const handleLongPress = useCallback(
    (event: GestureResponderEvent) => {
      if (!available) return;
      const { pageX, pageY } = event.nativeEvent;
      menu.setAnchorRect({ x: pageX, y: pageY, width: 0, height: 0 });
      menu.setOpen(true);
    },
    [available, menu],
  );

  return (
    <HeaderToggleButton
      testID={testID}
      onPress={handlePress}
      onLongPress={handleLongPress}
      disabled={!available}
      tooltipLabel={t(labelKey)}
      tooltipKeys={tooltipKeys}
      tooltipSide="bottom"
      accessibilityRole="button"
      accessibilityLabel={t(labelKey)}
      accessibilityState={accessibilityState}
    >
      {({ hovered, pressed }) => {
        let colorMapping = mutedColorMapping;
        if (!available) {
          colorMapping = extraMutedColorMapping;
        } else if (hovered || pressed) {
          colorMapping = foregroundColorMapping;
        }
        return <Icon size={16} uniProps={colorMapping} />;
      }}
    </HeaderToggleButton>
  );
}

export function NavigationBackButton() {
  const canGoBack = useCanNavigateBackInFocusHistory();
  return <NavigationHistoryButton direction="back" available={canGoBack} />;
}

/**
 * Hidden on compact layouts until there is somewhere to go forward to, so the phone
 * header only spends room on it after a Back.
 */
export function NavigationForwardButton() {
  const isCompact = useIsCompactFormFactor();
  const canGoForward = useCanNavigateForwardInFocusHistory();
  if (isCompact && !canGoForward) {
    return null;
  }
  return <NavigationHistoryButton direction="forward" available={canGoForward} />;
}
