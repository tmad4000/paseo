import { describe, expect, it } from "vitest";
import { mergeQuickLaunchPrompt } from "./prompt";

describe("mergeQuickLaunchPrompt", () => {
  it("uses the requested prompt when no draft is waiting", () => {
    expect(mergeQuickLaunchPrompt({ requested: "Fix the build", existing: "" })).toBe(
      "Fix the build",
    );
    expect(mergeQuickLaunchPrompt({ requested: "Fix the build", existing: "  \n" })).toBe(
      "Fix the build",
    );
  });

  it("keeps an unsent draft below a new prompt", () => {
    expect(
      mergeQuickLaunchPrompt({ requested: "Fix the build", existing: "Draft I left with Escape" }),
    ).toBe("Fix the build\n\nDraft I left with Escape");
  });

  it("does not duplicate a draft that already is the prompt", () => {
    expect(mergeQuickLaunchPrompt({ requested: "Retry me", existing: "Retry me" })).toBe(
      "Retry me",
    );
  });
});
