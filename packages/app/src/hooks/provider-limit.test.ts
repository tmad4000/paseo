import { describe, expect, it } from "vitest";
import type { CompanionEntry } from "@getpaseo/protocol/companion-stream";
import { buildHandoffDraftSetup, getProviderLimitNotice } from "./provider-limit";

function outcome(text: string, id = "limit", timestamp = "2026-11-09T21:28:33Z"): CompanionEntry {
  return { id, kind: "outcome", text, timestamp, truncated: false, status: "completed" };
}

describe("provider limit recovery", () => {
  it.each([
    "You've hit your weekly limit · resets Nov 12 at 4am (America/Denver)",
    "You’ve hit your usage limit. Visit https://chatgpt.com/settings/usage to purchase more credits.",
    "Rate limit exceeded. Please try again later.",
    "Quota exhausted",
  ])("recognizes direct terminal notices even when the turn was completed: %s", (message) => {
    expect(getProviderLimitNotice({ status: "idle", entries: [outcome(message)] })).toEqual({
      id: "limit",
      message,
    });
  });

  it.each(["running", "initializing"])("hides the recovery action while %s", (status) => {
    expect(
      getProviderLimitNotice({ status, entries: [outcome("You've hit your weekly limit")] }),
    ).toBeNull();
  });

  it("retires the notice after a newer successful turn, including a stale lastError", () => {
    expect(
      getProviderLimitNotice({
        status: "error",
        lastError: "Usage limit reached",
        entries: [
          outcome("Done", "done", "2026-11-09T22:00:00Z"),
          outcome("You've hit your weekly limit"),
        ],
      }),
    ).toBeNull();
  });

  it.each([
    "The API returned HTTP 429",
    "I added rate limit handling",
    "Here is an example: You've hit your weekly limit",
    "You've hit your keyboard shortcut limit",
  ])("does not treat discussion or tool failures as a provider limit: %s", (message) => {
    expect(getProviderLimitNotice({ status: "idle", entries: [outcome(message)] })).toBeNull();
  });

  it("does not use a pin or tracked ask as a limit notice", () => {
    expect(
      getProviderLimitNotice({
        status: "idle",
        entries: [
          {
            id: "pin",
            kind: "pin",
            timestamp: "2026-11-09T22:00:00Z",
            text: "Usage limit reached",
            truncated: false,
          },
        ],
      }),
    ).toBeNull();
  });

  it("supports error-only sessions before any outcome was captured", () => {
    expect(
      getProviderLimitNotice({ status: "error", lastError: "Usage limit reached" })?.message,
    ).toBe("Usage limit reached");
    expect(getProviderLimitNotice({ status: "idle", lastError: "Usage limit reached" })).toBeNull();
  });

  it("starts the alternate provider without a copied privileged mode or provider flags", () => {
    expect(
      buildHandoffDraftSetup({ provider: "codex", modelId: "chosen-model", cwd: "/work/project" }),
    ).toEqual({
      provider: "codex",
      model: "chosen-model",
      cwd: "/work/project",
      modeId: null,
      thinkingOptionId: null,
      featureValues: {},
    });
  });
});
