/**
 * Lets another drag take over an in-flight list reorder. A sidebar row dragged out over the
 * workspace becomes a drop somewhere else (see workspace-tabs/sidebar-session-drop), so the
 * reorder that started first must end as a cancel instead of moving the row in the list.
 *
 * Module state, because at most one pointer drag runs at a time. A reorder that starts clears any
 * leftover claim, so a claim made while no reorder was running never cancels a later one.
 */
let claimed = false;

export function claimActiveReorderDrop(): void {
  claimed = true;
}

/** Returns whether the current reorder was claimed, and clears the claim. */
export function consumeReorderDropClaim(): boolean {
  const wasClaimed = claimed;
  claimed = false;
  return wasClaimed;
}
