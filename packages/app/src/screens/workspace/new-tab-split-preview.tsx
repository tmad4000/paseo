import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { View, type PointerEvent } from "react-native";
import { Columns2, Rows2 } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  useContextMenu,
} from "@/components/ui/context-menu";
import { Shortcut } from "@/components/ui/shortcut";
import { isWeb } from "@/constants/platform";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useHoverSafeZone } from "@/hooks/use-hover-safe-zone";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import type { Theme } from "@/styles/theme";

/**
 * Hover intent for the split preview. Longer than the New Tab tooltip's 300ms so the tooltip
 * reads first and the split choices replace it, instead of both surfaces racing.
 */
export const NEW_TAB_SPLIT_HOVER_DELAY_MS = 450;

export interface NewTabSplitHoverState {
  isWeb: boolean;
  isCompact: boolean;
  pointerType: string;
  splitMenuOpen: boolean;
  newTabMenuOpen: boolean;
  armed: boolean;
  timerPending: boolean;
}

/**
 * Whether a pointer move over the New Tab button should start the split preview timer. A
 * preview re-arms only after the pointer leaves the button, so choosing a split (or opening the
 * New Tab menu) under a still pointer does not pop the preview straight back up.
 */
export function shouldStartNewTabSplitHover(state: NewTabSplitHoverState): boolean {
  return (
    state.isWeb &&
    !state.isCompact &&
    state.pointerType === "mouse" &&
    state.armed &&
    !state.splitMenuOpen &&
    !state.newTabMenuOpen &&
    !state.timerPending
  );
}

/** What the wrapped New Tab button needs to cooperate with the split preview. */
export interface NewTabSplitTriggerBindings {
  /** Long-press on touch opens the split choices; a plain press keeps opening New Tab. */
  onLongPress?: () => void;
  /** The tooltip steps aside while the split preview is showing. */
  tooltipEnabled: boolean;
  /** Report the New Tab menu so the preview closes when it opens and stays shut meanwhile. */
  onNewTabMenuOpenChange?: (open: boolean) => void;
}

const DISABLED_BINDINGS: NewTabSplitTriggerBindings = { tooltipEnabled: true };

interface NewTabSplitPreviewProps {
  onSplitRight?: () => void;
  onSplitDown?: () => void;
  testID?: string;
  children: (bindings: NewTabSplitTriggerBindings) => ReactNode;
}

/**
 * Wraps the New Tab (+) button so hovering it, long-pressing it, or right-clicking it offers
 * Split right / Split down. Each choice opens a new tab in a new pane in one step. The press
 * behavior of the wrapped button is unchanged. See docs/hover.md and docs/menus.md.
 */
export function NewTabSplitPreview({
  onSplitRight,
  onSplitDown,
  testID = "workspace-new-tab-split",
  children,
}: NewTabSplitPreviewProps): ReactNode {
  if (!onSplitRight || !onSplitDown) return children(DISABLED_BINDINGS);
  return (
    <NewTabSplitPreviewEnabled
      onSplitRight={onSplitRight}
      onSplitDown={onSplitDown}
      testID={testID}
    >
      {children}
    </NewTabSplitPreviewEnabled>
  );
}

function NewTabSplitPreviewEnabled({
  onSplitRight,
  onSplitDown,
  testID,
  children,
}: Required<Pick<NewTabSplitPreviewProps, "onSplitRight" | "onSplitDown" | "testID">> & {
  children: NewTabSplitPreviewProps["children"];
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [hoverPreview, setHoverPreview] = useState(false);
  const surfaceRef = useRef<View>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set when the preview closes or the New Tab menu opens; cleared once the pointer is outside.
  const [disarmed, setDisarmed] = useState(false);
  const cancelHover = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const handleOpenChange = useCallback(
    (next: boolean) => {
      cancelHover();
      // Only a real close (a choice, Escape, an outside press) waits for the pointer to leave.
      if (!next && open) setDisarmed(true);
      setHoverPreview(false);
      setOpen(next);
    },
    [cancelHover, open],
  );
  const handleHoverOpen = useCallback(() => {
    setHoverPreview(true);
    setOpen(true);
  }, []);
  const splitRightKeys = useShortcutKeys("workspace-pane-split-right");
  const splitDownKeys = useShortcutKeys("workspace-pane-split-down");
  const splitRightLeading = useMemo(
    () => <ThemedColumns2 size={14} uniProps={mutedColorMapping} />,
    [],
  );
  const splitDownLeading = useMemo(
    () => <ThemedRows2 size={14} uniProps={mutedColorMapping} />,
    [],
  );
  const splitRightTrailing = useMemo(
    () => (splitRightKeys ? <Shortcut chord={splitRightKeys} /> : null),
    [splitRightKeys],
  );
  const splitDownTrailing = useMemo(
    () => (splitDownKeys ? <Shortcut chord={splitDownKeys} /> : null),
    [splitDownKeys],
  );

  return (
    <ContextMenu
      open={open}
      onOpenChange={handleOpenChange}
      compactMode="popover"
      dismissKeyboardOnOpen={!hoverPreview}
    >
      <NewTabSplitHoverRegion
        surfaceRef={surfaceRef}
        timer={timer}
        disarmed={disarmed}
        setDisarmed={setDisarmed}
        cancel={cancelHover}
        hoverPreview={hoverPreview}
        onHoverOpen={handleHoverOpen}
        testID={testID}
      >
        {children}
      </NewTabSplitHoverRegion>
      <ContextMenuContent
        hoverPreview={hoverPreview}
        surfaceRef={surfaceRef}
        side="bottom"
        align="start"
        offset={4}
        minWidth={200}
        testID={`${testID}-menu`}
      >
        <ContextMenuItem
          leading={splitRightLeading}
          trailing={splitRightTrailing}
          testID={`${testID}-right`}
          onSelect={onSplitRight}
        >
          {t("workspace.tabs.actions.splitRight")}
        </ContextMenuItem>
        <ContextMenuItem
          leading={splitDownLeading}
          trailing={splitDownTrailing}
          testID={`${testID}-down`}
          onSelect={onSplitDown}
        >
          {t("workspace.tabs.actions.splitDown")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function NewTabSplitHoverRegion({
  hoverPreview,
  surfaceRef,
  timer,
  disarmed,
  setDisarmed,
  cancel,
  onHoverOpen,
  testID,
  children,
}: {
  hoverPreview: boolean;
  surfaceRef: React.RefObject<View | null>;
  timer: React.RefObject<ReturnType<typeof setTimeout> | null>;
  disarmed: boolean;
  setDisarmed: (disarmed: boolean) => void;
  cancel: () => void;
  onHoverOpen: () => void;
  testID: string;
  children: NewTabSplitPreviewProps["children"];
}) {
  const menu = useContextMenu();
  const isCompact = useIsCompactFormFactor();
  const triggerRef = useRef<View>(null);
  const [newTabMenuOpen, setNewTabMenuOpen] = useState(false);
  useEffect(() => cancel, [cancel, isCompact]);
  const setMenuOpen = menu.setOpen;
  useEffect(() => {
    if (isCompact) {
      cancel();
      if (hoverPreview) setMenuOpen(false);
    }
  }, [isCompact, hoverPreview, cancel, setMenuOpen]);
  const leave = useCallback(() => {
    cancel();
    if (hoverPreview) setMenuOpen(false);
  }, [cancel, hoverPreview, setMenuOpen]);
  // Re-arm from document movement rather than pointerleave: a menu backdrop that covers the
  // button swallows its boundary events, which would leave the preview disarmed for good.
  useEffect(() => {
    if (!isWeb || !disarmed) return;
    function handlePointerMove(event: globalThis.PointerEvent) {
      const node = triggerRef.current as unknown as Element | null;
      const rect = node?.getBoundingClientRect();
      const outside =
        !rect ||
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom;
      if (outside) setDisarmed(false);
    }
    document.addEventListener("pointermove", handlePointerMove);
    return () => document.removeEventListener("pointermove", handlePointerMove);
  }, [disarmed, setDisarmed]);
  const stay = useCallback(() => {}, []);
  // Only listen while a preview is up: every pane has a New Tab button.
  useHoverSafeZone({
    enabled: isWeb && !isCompact && menu.open && hoverPreview,
    triggerRef,
    contentRef: surfaceRef,
    onEnterSafeZone: stay,
    onLeaveSafeZone: leave,
  });
  const move = useCallback(
    (event: PointerEvent) => {
      const start = shouldStartNewTabSplitHover({
        isWeb,
        isCompact,
        pointerType: event.nativeEvent.pointerType,
        splitMenuOpen: menu.open,
        newTabMenuOpen,
        armed: !disarmed,
        timerPending: timer.current !== null,
      });
      if (!start) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        menu.setAnchorRect(null);
        onHoverOpen();
      }, NEW_TAB_SPLIT_HOVER_DELAY_MS);
    },
    [disarmed, isCompact, menu, newTabMenuOpen, onHoverOpen, timer],
  );
  const handlePointerLeave = cancel;
  const handleLongPress = useCallback(() => {
    cancel();
    menu.setAnchorRect(null);
    menu.setOpen(true);
  }, [cancel, menu]);
  const handleNewTabMenuOpenChange = useCallback(
    (next: boolean) => {
      setNewTabMenuOpen(next);
      if (!next) return;
      cancel();
      setDisarmed(true);
      if (menu.open) setMenuOpen(false);
    },
    [cancel, menu.open, setDisarmed, setMenuOpen],
  );
  const bindings = useMemo<NewTabSplitTriggerBindings>(
    () => ({
      onLongPress: isCompact ? undefined : handleLongPress,
      tooltipEnabled: !(menu.open && hoverPreview),
      onNewTabMenuOpenChange: handleNewTabMenuOpenChange,
    }),
    [handleLongPress, handleNewTabMenuOpenChange, hoverPreview, isCompact, menu.open],
  );
  return (
    <View
      ref={triggerRef}
      style={styles.region}
      onPointerMove={move}
      onPointerLeave={handlePointerLeave}
      testID={`${testID}-region`}
    >
      <ContextMenuTrigger contextOnly testID={`${testID}-trigger`}>
        {children(bindings)}
      </ContextMenuTrigger>
    </View>
  );
}

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedColumns2 = withUnistyles(Columns2);
const ThemedRows2 = withUnistyles(Rows2);

const styles = StyleSheet.create({
  region: {
    position: "relative",
  },
});
