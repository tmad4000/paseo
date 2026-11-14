export function isShortComposerPane(height: number | null): boolean {
  return height !== null && Number.isFinite(height) && height > 0 && height <= 520;
}

export function resolvePaneInputMaxHeight(windowMax: number, paneHeight: number | null): number {
  if (paneHeight === null || !Number.isFinite(paneHeight) || paneHeight <= 0) return windowMax;
  // Leave room for history and the toolbar, even when the window contains several rows.
  return Math.min(windowMax, Math.max(30, Math.floor(paneHeight * 0.3)));
}
