import { describe, expect, it } from "vitest";
import { buildFindPattern, countTextMatches } from "./matches";

describe("countTextMatches", () => {
  it("counts case-insensitive occurrences", () => {
    expect(countTextMatches("Deploy the deploy script. DEPLOY!", "deploy")).toBe(3);
  });

  it("matches a wrapped phrase across any whitespace run", () => {
    expect(countTextMatches("run the\n  failing tests", "the failing")).toBe(1);
  });

  it("escapes regex metacharacters in the query", () => {
    expect(countTextMatches("a.b a-b a.b", "a.b")).toBe(2);
    expect(countTextMatches("what? (yes)", "(yes)")).toBe(1);
  });

  it("ignores an empty or whitespace-only query", () => {
    expect(buildFindPattern("   ")).toBeNull();
    expect(countTextMatches("anything", "")).toBe(0);
  });
});
