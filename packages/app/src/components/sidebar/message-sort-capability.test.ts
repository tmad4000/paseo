import { expect, it } from "vitest";
import {
  canUseMessageSort,
  effectiveSidebarSortMode,
  messageSortAvailability,
} from "./message-sort-capability";

it("waits for server info and reports full, partial, or no message-activity support", () => {
  expect(messageSortAvailability([])).toBe("loading");
  expect(messageSortAvailability([undefined])).toBe("loading");
  expect(messageSortAvailability([false, undefined])).toBe("loading");
  expect(messageSortAvailability([true, undefined])).toBe("ready");
  expect(messageSortAvailability([true, true])).toBe("ready");
  expect(messageSortAvailability([false])).toBe("unsupported");
  expect(messageSortAvailability([false, false])).toBe("unsupported");
});

it("keeps message sorts usable when one older host sits beside a supporting host", () => {
  expect(messageSortAvailability([true, false])).toBe("partial");
  expect(messageSortAvailability([false, true, undefined])).toBe("partial");
  expect(canUseMessageSort("partial")).toBe(true);
  expect(canUseMessageSort("ready")).toBe(true);
  expect(canUseMessageSort("loading")).toBe(false);
  expect(canUseMessageSort("unsupported")).toBe(false);
});

it("applies the saved message sort only when some host supports it", () => {
  for (const mode of ["recent", "user", "assistant"] as const) {
    expect(effectiveSidebarSortMode(mode, "loading")).toBe("manual");
    expect(effectiveSidebarSortMode(mode, "unsupported")).toBe("manual");
    expect(effectiveSidebarSortMode(mode, "partial")).toBe(mode);
    expect(effectiveSidebarSortMode(mode, "ready")).toBe(mode);
  }
  expect(effectiveSidebarSortMode("title", "unsupported")).toBe("title");
  expect(effectiveSidebarSortMode("manual", "unsupported")).toBe("manual");
});
