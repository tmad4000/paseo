import { describe, expect, it } from "vitest";
import { getUserMessagePreview, USER_PROMPT_PREVIEW_CHARACTERS } from "./user-message-preview";

describe("long prompt previews", () => {
  it("leaves short text and text at the character limit intact", () => {
    for (const text of ["Short prompt", "x".repeat(USER_PROMPT_PREVIEW_CHARACTERS)]) {
      expect(getUserMessagePreview(text)).toEqual({ text, truncated: false });
    }
  });
  it("ends a long unbroken prompt with an ellipsis", () => {
    expect(getUserMessagePreview("x".repeat(5000))).toEqual({
      text: "x".repeat(400) + "…",
      truncated: true,
    });
  });
  it("limits explicit lines even when the message has few characters", () => {
    expect(getUserMessagePreview("1\n2\n3\n4\n5\n6\n7")).toEqual({
      text: "1\n2\n3\n4\n5\n6…",
      truncated: true,
    });
  });
  it.each(["😀", "é", "👨‍👩‍👧‍👦", "👍🏽", "🇺🇸"])("does not split a %s grapheme", (cluster) => {
    const prefix = "x".repeat(399);
    expect(getUserMessagePreview(prefix + cluster + "tail").text).toBe(prefix + "…");
  });
});
