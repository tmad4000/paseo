import { describe, expect, it } from "vitest";
import { shouldShowKeyboardDismissButton } from "./keyboard-dismiss-model";

describe("shouldShowKeyboardDismissButton", () => {
  it("shows the control while the software keyboard occupies space", () => {
    expect(shouldShowKeyboardDismissButton(336)).toBe(true);
    expect(shouldShowKeyboardDismissButton(1)).toBe(true);
  });

  it("hides the control when the keyboard is closed", () => {
    expect(shouldShowKeyboardDismissButton(0)).toBe(false);
  });

  it("hides the control for a hardware keyboard, which reserves no inset", () => {
    // A focused composer with a hardware keyboard publishes a zero (or
    // transiently negative) settled shift; there is nothing to dismiss.
    expect(shouldShowKeyboardDismissButton(0)).toBe(false);
    expect(shouldShowKeyboardDismissButton(-8)).toBe(false);
  });
});
