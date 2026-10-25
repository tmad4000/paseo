import { describe, expect, it } from "vitest";
import { buildTagCloud, mergeTagCounts, suggestTags, toggleTag } from "./tag-model";

describe("buildTagCloud", () => {
  const counts = [
    { tag: "quotes", count: 9 },
    { tag: "ideas", count: 4 },
    { tag: "misc", count: 1 },
  ];

  it("puts pinned tags first in pin order, then the rest by count", () => {
    const cloud = buildTagCloud(counts, ["misc"], []);
    expect(cloud.map((item) => [item.tag, item.pinned])).toEqual([
      ["misc", true],
      ["quotes", false],
      ["ideas", false],
    ]);
  });

  it("scales weight mildly and keeps pinned or active tags with no matches", () => {
    const cloud = buildTagCloud(counts, ["gone"], ["ideas", "stale"]);
    expect(cloud.map((item) => [item.tag, item.weight, item.active, item.count])).toEqual([
      ["gone", 0, false, 0],
      ["quotes", 2, false, 9],
      ["ideas", 1, true, 4],
      ["misc", 0, false, 1],
      ["stale", 0, true, 0],
    ]);
    // A small Stream does not get size steps at all.
    expect(buildTagCloud([{ tag: "a", count: 2 }], [], []).map((item) => item.weight)).toEqual([0]);
  });
});

describe("tag helpers", () => {
  it("toggles, merges host counts and suggests by prefix first", () => {
    expect(toggleTag(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleTag(["a", "b"], "a")).toEqual(["b"]);
    expect(
      mergeTagCounts([
        [{ tag: "a", count: 1 }],
        [
          { tag: "b", count: 3 },
          { tag: "a", count: 1 },
        ],
      ]),
    ).toEqual([
      { tag: "b", count: 3 },
      { tag: "a", count: 2 },
    ]);
    expect(suggestTags(["design", "redesign", "docs", "deploy"], "#De", ["deploy"])).toEqual([
      "design",
      "redesign",
    ]);
    expect(suggestTags(["a", "b"], "", ["a"])).toEqual(["b"]);
  });
});
