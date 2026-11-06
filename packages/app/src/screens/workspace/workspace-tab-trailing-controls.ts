export interface TabTrailingControlsInput {
  canMarkRead: boolean;
  showCloseButton: boolean;
  isActive: boolean;
  isHovered: boolean;
  isClosingTab: boolean;
  /** Native and compact layouts have no hover, so their controls stay visible. */
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
  const { canMarkRead, showCloseButton, isActive, isHovered, isClosingTab, isTouch } = input;
  const showCloseControl = showCloseButton && (isHovered || isTouch || isClosingTab);
  // The open tab keeps its check in view: with explicit reads it is the tab being read, and
  // hovering to find the control would be a chore.
  const showReadControl = canMarkRead && !isClosingTab && (isHovered || isTouch || isActive);
  return {
    showReadControl,
    showCloseControl,
    showTrailingOverlay: showCloseControl || showReadControl,
    readSitsBesideClose: showReadControl && showCloseButton,
  };
}
