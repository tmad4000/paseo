import { describe, expect, it } from "vitest";
import { buildWorkspaceFocusSummary, truncateFocusText } from "./workspace-focus.js";

describe("truncateFocusText", () => {
  it("collapses whitespace and returns null for empty input", () => {
    expect(truncateFocusText("  fix\n\n the   bug ", 50)).toBe("fix the bug");
    expect(truncateFocusText("   ", 50)).toBeNull();
    expect(truncateFocusText(null, 50)).toBeNull();
  });

  it("cuts at a word boundary and marks the cut", () => {
    const text = "Build the workspace describe tool for the Paseo fork daemon";
    const cut = truncateFocusText(text, 30);
    expect(cut).toBe("Build the workspace describe…");
    expect(cut!.length).toBeLessThanOrEqual(30);
  });
});

describe("buildWorkspaceFocusSummary", () => {
  it("combines first, last, reply, asks and pins into one paragraph", () => {
    const summary = buildWorkspaceFocusSummary({
      title: "Workspace tabs",
      firstUserMessage: "Add describe_workspace",
      lastUserMessage: "Merge it when CI is green",
      lastAssistantMessage: "CI is running on PR #140.",
      openAsks: [{ askId: "a1", text: "Ship describe_workspace", state: "in_progress" }],
      pins: [{ entryId: "pin:1", text: "Do not restart the daemon" }],
    });
    expect(summary).toBe(
      'Started with "Add describe_workspace". Latest user message: "Merge it when CI is green". ' +
        'Last reply began: "CI is running on PR #140.". Open asks: Ship describe_workspace [in_progress]. ' +
        'Pinned: "Do not restart the daemon".',
    );
  });

  it("does not repeat the first message when it is also the last", () => {
    const summary = buildWorkspaceFocusSummary({
      title: null,
      firstUserMessage: "only message",
      lastUserMessage: "only message",
      lastAssistantMessage: null,
      openAsks: null,
      pins: null,
    });
    expect(summary).toBe('Started with "only message".');
  });

  it("caps the number of asks and reports the rest", () => {
    const openAsks = Array.from({ length: 7 }, (_, index) => ({
      askId: `a${index}`,
      text: `ask ${index}`,
      state: "open",
    }));
    const summary = buildWorkspaceFocusSummary({
      title: null,
      firstUserMessage: null,
      lastUserMessage: null,
      lastAssistantMessage: null,
      openAsks,
      pins: [],
    });
    expect(summary).toContain("ask 4 [open] (+2 more).");
    expect(summary).not.toContain("ask 5");
  });

  it("falls back to the title when nothing is readable", () => {
    expect(
      buildWorkspaceFocusSummary({
        title: "Gemini helper",
        firstUserMessage: null,
        lastUserMessage: null,
        lastAssistantMessage: null,
        openAsks: null,
        pins: null,
      }),
    ).toBe('No readable conversation yet; titled "Gemini helper".');
  });
});
