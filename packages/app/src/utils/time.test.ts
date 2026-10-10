import { describe, it, expect } from "vitest";
import {
  describeCompactTimeAgo,
  formatCompactTimeAgo,
  formatDuration,
  formatMessageTimestamp,
  formatTimeAgo,
} from "./time";

describe("formatTimeAgo", () => {
  const now = new Date("2026-07-16T12:00:00.000Z");

  it.each([
    ["2026-07-16T11:59:55.000Z", "just now"],
    ["2026-07-16T11:59:30.000Z", "30s ago"],
    ["2026-07-16T11:55:00.000Z", "5m ago"],
    ["2026-07-16T10:00:00.000Z", "2h ago"],
    ["2026-07-13T12:00:00.000Z", "3d ago"],
    ["2026-01-15T12:00:00.000Z", "Jan 15"],
  ])("formats %s as %s", (date, expected) => {
    expect(formatTimeAgo(new Date(date), now)).toBe(expected);
  });
});

describe("describeCompactTimeAgo", () => {
  const now = new Date("2026-07-16T12:00:00.000Z");

  it.each([
    ["2026-07-16T11:59:59.000Z", "now", "minute"],
    ["2026-07-16T11:59:30.000Z", "now", "minute"],
    ["2026-07-16T11:59:00.000Z", "1m", "minute"],
    ["2026-07-16T11:55:00.000Z", "5m", "minute"],
    ["2026-07-16T11:00:00.000Z", "1h", "hour"],
    ["2026-07-16T10:00:00.000Z", "2h", "hour"],
    ["2026-07-15T12:00:00.000Z", "1d", "day"],
    ["2026-07-13T12:00:00.000Z", "3d", "day"],
    ["2026-07-10T12:00:00.000Z", "6d", "day"],
    ["2026-07-09T12:00:00.000Z", "Jul 9", "static"],
    ["2026-01-15T12:00:00.000Z", "Jan 15", "static"],
  ] as const)("formats %s as %s at %s resolution", (date, label, resolution) => {
    expect(describeCompactTimeAgo(new Date(date), now)).toEqual({ label, resolution });
  });

  it("never shows a sub-minute count", () => {
    // A seconds label is only true for the second it rendered. Everything under a minute is
    // "now", which stays true and lets the row sit still.
    for (let seconds = 0; seconds < 60; seconds += 1) {
      const date = new Date(now.getTime() - seconds * 1000);
      expect(describeCompactTimeAgo(date, now).label).toBe("now");
    }
  });

  it("switches to an absolute date exactly at seven days", () => {
    const almost = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000 - 1));
    const exactly = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    expect(describeCompactTimeAgo(almost, now).resolution).toBe("day");
    expect(describeCompactTimeAgo(exactly, now).resolution).toBe("static");
  });

  it("keeps formatCompactTimeAgo as the label alone", () => {
    const date = new Date("2026-07-16T10:00:00.000Z");
    expect(formatCompactTimeAgo(date, now)).toBe(describeCompactTimeAgo(date, now).label);
  });
});

describe("formatDuration", () => {
  it("renders sub-minute durations as whole seconds", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(5_600)).toBe("5s");
    expect(formatDuration(9_900)).toBe("9s");
    expect(formatDuration(10_400)).toBe("10s");
    expect(formatDuration(12_340)).toBe("12s");
    expect(formatDuration(47_000)).toBe("47s");
  });

  it("renders minutes and remainder seconds without decimals", () => {
    expect(formatDuration(75_230)).toBe("1m 15s");
    expect(formatDuration(132_000)).toBe("2m 12s");
    expect(formatDuration(120_000)).toBe("2m");
  });

  it("renders hours and remainder minutes without decimals", () => {
    expect(formatDuration(3_900_000)).toBe("1h 5m");
    expect(formatDuration(3_600_000)).toBe("1h");
  });

  it("guards against negative and NaN", () => {
    expect(formatDuration(-1)).toBe("0s");
    expect(formatDuration(Number.NaN)).toBe("0s");
  });
});

describe("formatMessageTimestamp", () => {
  it("shows only time for same-day timestamps", () => {
    const now = new Date(2026, 4, 14, 17, 30);
    const date = new Date(2026, 4, 14, 12, 23);
    const formatted = formatMessageTimestamp(date, now);
    expect(formatted).toMatch(/12:23/);
    expect(formatted).not.toMatch(/May|Thursday/);
  });

  it("shows the date, not a weekday, for the previous calendar day", () => {
    // 2026-05-13 is a Wednesday; its date must be readable without weekday math.
    const now = new Date(2026, 4, 14, 0, 30);
    const date = new Date(2026, 4, 13, 22, 12);
    const formatted = formatMessageTimestamp(date, now);
    expect(formatted).toMatch(/May/);
    expect(formatted).toMatch(/13/);
    expect(formatted).not.toMatch(/Wednesday/);
    expect(formatted).toMatch(/10:12 PM|22:12/);
  });

  it("shows the date within the last week instead of a weekday", () => {
    // 2026-05-14 is a Thursday. 2026-05-11 is a Monday.
    const now = new Date(2026, 4, 14, 17, 30);
    const date = new Date(2026, 4, 11, 22, 12);
    const formatted = formatMessageTimestamp(date, now);
    expect(formatted).toMatch(/May/);
    expect(formatted).toMatch(/11/);
    expect(formatted).not.toMatch(/Monday/);
  });

  it("omits the year for an older same-year date", () => {
    const now = new Date(2026, 4, 14, 17, 30);
    const date = new Date(2026, 3, 1, 9, 5);
    const formatted = formatMessageTimestamp(date, now);
    expect(formatted).toMatch(/Apr|April/);
    expect(formatted).not.toMatch(/2026/);
  });

  it("includes the year for a prior-year date", () => {
    const now = new Date(2026, 4, 14, 17, 30);
    const date = new Date(2025, 9, 9, 21, 15);
    const formatted = formatMessageTimestamp(date, now);
    expect(formatted).toMatch(/Oct|October/);
    expect(formatted).toMatch(/2025/);
    expect(formatted).toMatch(/9:15 PM|21:15/);
  });

  it("includes the year across a year boundary even one day apart", () => {
    const now = new Date(2026, 0, 1, 10, 0);
    const date = new Date(2025, 11, 31, 23, 45);
    const formatted = formatMessageTimestamp(date, now);
    expect(formatted).toMatch(/Dec|December/);
    expect(formatted).toMatch(/2025/);
  });
});
