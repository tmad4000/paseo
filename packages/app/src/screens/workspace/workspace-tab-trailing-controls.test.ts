import { describe, expect, it } from "vitest";
import { resolveTabTrailingControls } from "./workspace-tab-trailing-controls";

const base = {
  canMarkRead: true,
  showCloseButton: true,
  isKeyboardFocused: false,
  isHovered: false,
  isClosingTab: false,
  isTouch: false,
};

describe("resolveTabTrailingControls", () => {
  it("keeps a background tab clean until it is hovered", () => {
    expect(resolveTabTrailingControls(base).showTrailingOverlay).toBe(false);
    expect(resolveTabTrailingControls({ ...base, isHovered: true })).toEqual({
      showReadControl: true,
      showCloseControl: true,
      showTrailingOverlay: true,
      readSitsBesideClose: true,
    });
  });

  it("shows the keyboard-focused tab's check without hover, in the slot it keeps when hovered", () => {
    const resting = resolveTabTrailingControls({ ...base, isKeyboardFocused: true });
    const hovered = resolveTabTrailingControls({
      ...base,
      isKeyboardFocused: true,
      isHovered: true,
    });
    expect(resting).toEqual({
      showReadControl: true,
      showCloseControl: true,
      showTrailingOverlay: true,
      readSitsBesideClose: true,
    });
    expect(hovered.readSitsBesideClose).toBe(resting.readSitsBesideClose);
    expect(hovered.showCloseControl).toBe(true);
  });

  it("puts the check in the trailing slot of a tab that cannot close", () => {
    expect(
      resolveTabTrailingControls({ ...base, showCloseButton: false, isKeyboardFocused: true }),
    ).toMatchObject({ showReadControl: true, readSitsBesideClose: false });
  });

  it("leaves the close button as before when there is nothing to read", () => {
    const nothingToRead = { ...base, canMarkRead: false };
    expect(resolveTabTrailingControls(nothingToRead)).toEqual({
      showReadControl: false,
      showCloseControl: false,
      showTrailingOverlay: false,
      readSitsBesideClose: false,
    });
    expect(
      resolveTabTrailingControls({ ...nothingToRead, isHovered: true }).showTrailingOverlay,
    ).toBe(true);
  });

  it("uses the menu for read on touch, and hides the check while the tab closes", () => {
    expect(resolveTabTrailingControls({ ...base, isTouch: true }).showReadControl).toBe(false);
    expect(
      resolveTabTrailingControls({ ...base, isHovered: true, isClosingTab: true }).showReadControl,
    ).toBe(false);
  });
});
