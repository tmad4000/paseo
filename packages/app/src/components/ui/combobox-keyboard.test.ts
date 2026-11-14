import { describe, expect, it } from "vitest";

import { getNextActiveIndex, resolveComboboxActiveIndex } from "./combobox-keyboard";

describe("getNextActiveIndex", () => {
  it("returns -1 when itemCount is 0", () => {
    expect(getNextActiveIndex({ currentIndex: 0, itemCount: 0, key: "ArrowDown" })).toBe(-1);
  });

  it("starts at 0 on ArrowDown when no active item", () => {
    expect(getNextActiveIndex({ currentIndex: -1, itemCount: 3, key: "ArrowDown" })).toBe(0);
  });

  it("starts at last on ArrowUp when no active item", () => {
    expect(getNextActiveIndex({ currentIndex: -1, itemCount: 3, key: "ArrowUp" })).toBe(2);
  });

  it("wraps around on ArrowDown and ArrowUp", () => {
    expect(getNextActiveIndex({ currentIndex: 2, itemCount: 3, key: "ArrowDown" })).toBe(0);
    expect(getNextActiveIndex({ currentIndex: 0, itemCount: 3, key: "ArrowUp" })).toBe(2);
  });
});

it("keeps the highlighted tab through live title changes and safely falls back when it closes", () => {
  const input = {
    selectedId: "current",
    search: "session",
    position: "below-search" as const,
    previous: { id: "highlighted", search: "session" },
    preserve: true,
  };
  expect(
    resolveComboboxActiveIndex({
      ...input,
      options: [{ id: "new-top-match" }, { id: "highlighted" }],
    }),
  ).toBe(1);
  expect(resolveComboboxActiveIndex({ ...input, options: [{ id: "remaining" }] })).toBe(0);
  expect(resolveComboboxActiveIndex({ ...input, options: [] })).toBe(-1);
  expect(
    resolveComboboxActiveIndex({
      ...input,
      search: "different",
      options: [{ id: "new-top-match" }, { id: "highlighted" }],
    }),
  ).toBe(0);
  expect(
    resolveComboboxActiveIndex({
      ...input,
      search: "",
      options: [{ id: "current" }, { id: "highlighted" }],
    }),
  ).toBe(0);
});
