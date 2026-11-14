export interface TabTrailingControlsInput {
  canMarkRead: boolean;
  showCloseButton: boolean;
  isKeyboardFocused: boolean;
  isHovered: boolean;
  isClosingTab: boolean;
  /** Touch uses the existing tab menu for mark as read. */
  isTouch: boolean;
}

export interface TabTrailingControls {
  showReadControl: boolean;
  /** The close button stays mounted while hidden so hover can fade it in. */
  showCloseControl: boolean;
  showTrailingOverlay: boolean;
  /**
   * The check sits left of the close slot whenever the tab has one, shown or not, so it never
   * moves under the pointer and hovering never slides the close button into its place.
   */
  readSitsBesideClose: boolean;
}

/** Which trailing controls a desktop tab chip shows: its read check and its close button. */
export function resolveTabTrailingControls(input: TabTrailingControlsInput): TabTrailingControls {
  const { canMarkRead, showCloseButton, isKeyboardFocused, isHovered, isClosingTab, isTouch } =
    input;
  const showCloseControl =
    showCloseButton && (isHovered || isKeyboardFocused || isTouch || isClosingTab);
  const showReadControl = canMarkRead && !isClosingTab && (isHovered || isKeyboardFocused);
  return {
    showReadControl,
    showCloseControl,
    showTrailingOverlay: showCloseControl || showReadControl,
    readSitsBesideClose: showReadControl && showCloseButton,
  };
}
