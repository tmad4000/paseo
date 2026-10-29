import { describe, expect, it } from "vitest";
import {
  shouldStartNewTabSplitHover,
  type NewTabSplitHoverState,
} from "@/screens/workspace/new-tab-split-preview";

const base: NewTabSplitHoverState = {
  isWeb: true,
  isCompact: false,
  pointerType: "mouse",
  splitMenuOpen: false,
  newTabMenuOpen: false,
  armed: true,
  timerPending: false,
};

describe("shouldStartNewTabSplitHover", () => {
  it("starts the preview timer for a mouse resting on the New Tab button", () => {
    expect(shouldStartNewTabSplitHover(base)).toBe(true);
  });

  it("never opens from touch or pen movement; long-press is the touch path", () => {
    expect(shouldStartNewTabSplitHover({ ...base, pointerType: "touch" })).toBe(false);
    expect(shouldStartNewTabSplitHover({ ...base, pointerType: "pen" })).toBe(false);
  });

  it("stays off on native and compact layouts", () => {
    expect(shouldStartNewTabSplitHover({ ...base, isWeb: false })).toBe(false);
    expect(shouldStartNewTabSplitHover({ ...base, isCompact: true })).toBe(false);
  });

  it("does not compete with an open New Tab menu or an already open split menu", () => {
    expect(shouldStartNewTabSplitHover({ ...base, newTabMenuOpen: true })).toBe(false);
    expect(shouldStartNewTabSplitHover({ ...base, splitMenuOpen: true })).toBe(false);
  });

  it("waits for the pointer to leave after a choice before offering again", () => {
    expect(shouldStartNewTabSplitHover({ ...base, armed: false })).toBe(false);
  });

  it("keeps a single pending timer", () => {
    expect(shouldStartNewTabSplitHover({ ...base, timerPending: true })).toBe(false);
  });
});
