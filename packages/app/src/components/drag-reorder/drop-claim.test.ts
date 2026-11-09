import { describe, expect, it } from "vitest";
import { claimActiveReorderDrop, consumeReorderDropClaim } from "./drop-claim";

describe("reorder drop claim", () => {
  it("reports a claim once", () => {
    claimActiveReorderDrop();
    expect(consumeReorderDropClaim()).toBe(true);
    expect(consumeReorderDropClaim()).toBe(false);
  });

  it("is unclaimed by default", () => {
    expect(consumeReorderDropClaim()).toBe(false);
  });
});
