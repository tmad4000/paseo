import { describe, expect, it } from "vitest";
import { resolveTabTrailingControls } from "./workspace-tab-trailing-controls";

const base = {
  canMarkRead: true,
  showCloseButton: true,
  isActive: false,
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

  it("shows the open tab's check without hover, in the slot it keeps when hovered", () => {
    const resting = resolveTabTrailingControls({ ...base, isActive: true });
    const hovered = resolveTabTrailingControls({ ...base, isActive: true, isHovered: true });
    expect(resting).toEqual({
      showReadControl: true,
      showCloseControl: false,
      showTrailingOverlay: true,
      readSitsBesideClose: true,
    });
    expect(hovered.readSitsBesideClose).toBe(resting.readSitsBesideClose);
    expect(hovered.showCloseControl).toBe(true);
  });

  it("puts the check in the trailing slot of a tab that cannot close", () => {
    expect(
      resolveTabTrailingControls({ ...base, showCloseButton: false, isActive: true }),
    ).toMatchObject({ showReadControl: true, readSitsBesideClose: false });
  });

  it("leaves the close button as before when there is nothing to read", () => {
    const nothingToRead = { ...base, canMarkRead: false };
    expect(resolveTabTrailingControls({ ...nothingToRead, isActive: true })).toEqual({
      showReadControl: false,
      showCloseControl: false,
      showTrailingOverlay: false,
      readSitsBesideClose: false,
    });
    expect(
      resolveTabTrailingControls({ ...nothingToRead, isHovered: true }).showTrailingOverlay,
    ).toBe(true);
  });

  it("shows both controls on touch, and hides the check while the tab closes", () => {
    expect(resolveTabTrailingControls({ ...base, isTouch: true }).readSitsBesideClose).toBe(true);
    expect(
      resolveTabTrailingControls({ ...base, isHovered: true, isClosingTab: true }).showReadControl,
    ).toBe(false);
  });
});
