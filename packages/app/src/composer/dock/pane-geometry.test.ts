import { describe, expect, it } from "vitest";
import { isShortComposerPane, resolvePaneInputMaxHeight } from "./pane-geometry";

describe("composer pane geometry", () => {
  it("compacts stacked rows while keeping full-height panes spacious", () => {
    expect(isShortComposerPane(320)).toBe(true);
    expect(isShortComposerPane(520)).toBe(true);
    expect(isShortComposerPane(521)).toBe(false);
    expect(isShortComposerPane(900)).toBe(false);
  });

  it.each([null, 0, -1, NaN, Infinity])("ignores unavailable geometry %s", (height) => {
    expect(isShortComposerPane(height)).toBe(false);
    expect(resolvePaneInputMaxHeight(300, height)).toBe(300);
  });

  it("bounds a long draft by its own pane instead of the whole window", () => {
    expect(resolvePaneInputMaxHeight(300, 320)).toBe(96);
    expect(resolvePaneInputMaxHeight(300, 480)).toBe(144);
    expect(resolvePaneInputMaxHeight(300, 1200)).toBe(300);
  });

  it("keeps one line usable in an extremely short pane", () => {
    expect(resolvePaneInputMaxHeight(300, 60)).toBe(30);
  });
});
