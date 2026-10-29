import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View, type GestureResponderEvent, type PointerEvent } from "react-native";
import { ArrowLeft, ArrowRight, ChevronDown } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { HeaderToggleButton } from "./header-toggle-button";
import { DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { iconButtonChromeStyle } from "@/components/ui/icon-button-chrome";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  useContextMenu,
} from "@/components/ui/context-menu";
import { isWeb } from "@/constants/platform";
import { useHoverSafeZone } from "@/hooks/use-hover-safe-zone";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
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

const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedArrowLeft = withUnistyles(ArrowLeft);
const ThemedArrowRight = withUnistyles(ArrowRight);
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const extraMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundExtraMuted });

const DIRECTIONS = {
  back: {
    testID: "navigation-back-button",
    labelKey: "common.actions.navigateBack",
    historyLabelKey: "common.actions.backHistory",
    shortcutHelpId: "navigation-back",
    Icon: ThemedArrowLeft,
  },
  forward: {
    testID: "navigation-forward-button",
    labelKey: "common.actions.navigateForward",
    historyLabelKey: "common.actions.forwardHistory",
    shortcutHelpId: "navigation-forward",
    Icon: ThemedArrowRight,
  },
} as const satisfies Record<
  NavigationFocusHistoryDirection,
  {
    testID: string;
    labelKey: string;
    historyLabelKey: string;
    shortcutHelpId: string;
    Icon: typeof ThemedArrowLeft;
  }
>;

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
    return entries.map((location) => describeFocusLocation(location, deps));
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
  const { testID, historyLabelKey } = DIRECTIONS[direction];
  const [open, setOpen] = useState(false);
  const [hoverPreview, setHoverPreview] = useState(false);
  const surfaceRef = useRef<View>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelHover = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const handleOpenChange = useCallback((next: boolean) => {
    cancelHover();
    setHoverPreview(false);
    setOpen(next);
  }, [cancelHover]);
  const handleHoverOpen = useCallback(() => {
    setHoverPreview(true);
    setOpen(true);
  }, []);

  // Both the visible chevron and the existing right-click/long-press gesture open
  // the same menu. The arrow remains a one-step Back/Forward action.
  return (
    <ContextMenu open={open} onOpenChange={handleOpenChange} dismissKeyboardOnOpen={!hoverPreview}>
      <NavigationHistoryHoverRegion
        available={available}
        surfaceRef={surfaceRef}
        timer={timer}
        cancel={cancelHover}
        hoverPreview={hoverPreview}
        onHoverOpen={handleHoverOpen}
      >
        <ContextMenuTrigger contextOnly enabled={available} testID={`${testID}-history-trigger`}>
          <NavigationHistoryPressable direction={direction} available={available} />
        </ContextMenuTrigger>
        <NavigationHistoryDropdownTrigger direction={direction} available={available} hoverPreview={hoverPreview} />
      </NavigationHistoryHoverRegion>
      <ContextMenuContent
        hoverPreview={hoverPreview}
        surfaceRef={surfaceRef}
        offset={0}
        align="start"
        minWidth={240}
        maxWidth={360}
        sheetTitle={t(historyLabelKey)}
        scrollable
        maxHeight={480}
        testID={`${testID}-history`}
      >
        <NavigationHistoryMenuItems direction={direction} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** A pointer preview shares the real menu and leaves click/keyboard/touch opening unchanged. */
function NavigationHistoryHoverRegion({
  available,
  hoverPreview,
  surfaceRef,
  timer,
  cancel,
  onHoverOpen,
  children,
}: {
  available: boolean;
  hoverPreview: boolean;
  surfaceRef: React.RefObject<View | null>;
  timer: React.RefObject<ReturnType<typeof setTimeout> | null>;
  cancel: () => void;
  onHoverOpen: () => void;
  children: React.ReactNode;
}) {
  const menu = useContextMenu();
  const isCompact = useIsCompactFormFactor();
  const triggerRef = useRef<View>(null);
  useEffect(() => cancel, [cancel, available, isCompact]);
  const setMenuOpen = menu.setOpen;
  useEffect(() => {
    if (!available || isCompact) {
      cancel();
      if (hoverPreview) setMenuOpen(false);
    }
  }, [available, isCompact, hoverPreview, cancel, setMenuOpen]);
  const leave = useCallback(() => {
    cancel();
    if (hoverPreview) menu.setOpen(false);
  }, [cancel, hoverPreview, menu]);
  const stay = useCallback(() => {}, []);
  useHoverSafeZone({
    enabled: isWeb && !isCompact && available,
    triggerRef,
    contentRef: surfaceRef,
    onEnterSafeZone: stay,
    onLeaveSafeZone: leave,
  });
  const move = useCallback(
    (event: PointerEvent) => {
      if (
        !isWeb ||
        isCompact ||
        !available ||
        menu.open ||
        timer.current ||
        event.nativeEvent.pointerType !== "mouse"
      )
        return;
      timer.current = setTimeout(() => {
        timer.current = null;
        menu.setAnchorRect(null);
        onHoverOpen();
      }, 350);
    },
    [isCompact, available, menu, onHoverOpen],
  );
  return (
    <View ref={triggerRef} style={styles.buttonGroup} onPointerMove={move}>
      {children}
    </View>
  );
}

function NavigationHistoryDropdownTrigger({
  direction,
  available,
  hoverPreview,
}: {
  direction: NavigationFocusHistoryDirection;
  available: boolean;
  hoverPreview: boolean;
}) {
  const { t } = useTranslation();
  const menu = useContextMenu();
  const activate = useCallback(() => {
    menu.setOpen(hoverPreview || !menu.open);
  }, [hoverPreview, menu]);
  const { testID, historyLabelKey } = DIRECTIONS[direction];
  const label = t(historyLabelKey);
  const triggerStyle = useCallback(
    (state: { hovered: boolean; pressed: boolean; open: boolean }) =>
      iconButtonChromeStyle({ size: "large", state, disabled: !available }),
    [available],
  );

  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild>
        <DropdownMenuTrigger
          testID={`${testID}-history-menu-button`}
          accessibilityRole="button"
          accessibilityLabel={label}
          disabled={!available}
          onActivate={activate}
          style={triggerStyle}
        >
          {({ hovered, open }) => {
            let colorMapping = mutedColorMapping;
            if (!available) {
              colorMapping = extraMutedColorMapping;
            } else if (hovered || open) {
              colorMapping = foregroundColorMapping;
            }
            return <ThemedChevronDown size={14} uniProps={colorMapping} />;
          }}
        </DropdownMenuTrigger>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="center" offset={8}>
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
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
  const { testID, labelKey, shortcutHelpId, Icon } = DIRECTIONS[direction];
  // The effective binding, so a rebound Back/Forward advertises what it now does.
  const shortcutKeys = useShortcutKeys(shortcutHelpId);
  const tooltipKeys = useMemo<ShortcutKey[]>(
    () => (isCompact || !shortcutKeys ? [] : (shortcutKeys[0] ?? [])),
    [isCompact, shortcutKeys],
  );
  const accessibilityState = useMemo(() => ({ disabled: !available }), [available]);
  const handlePress = useCallback(() => {
    menu.setOpen(false);
    navigateInFocusHistory(direction, { isCompact });
  }, [direction, isCompact, menu]);
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

const styles = StyleSheet.create((theme) => ({
  buttonGroup: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
  },
  tooltipText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.popoverForeground,
  },
}));
