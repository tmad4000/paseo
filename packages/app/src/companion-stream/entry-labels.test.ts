import { beforeAll, describe, expect, it } from "vitest";
import type { CompanionEntry } from "@getpaseo/protocol/companion-stream";
import { i18n } from "@/i18n/i18next";
import { describeEntry, splitEntryText } from "./entry-labels";

const base = { timestamp: "2026-10-24T21:10:00Z", text: "x", truncated: false };

describe("describeEntry", () => {
  // The real instance, so a label naming a missing key renders as that key and fails.
  beforeAll(async () => {
    if (!i18n.isInitialized) await i18n.init();
    await i18n.changeLanguage("en");
  });
  const label = (entry: CompanionEntry) => describeEntry(entry, i18n.t);

  it("labels a tracked ask by its state without provenance wording", () => {
    const eyebrow = label({
      ...base,
      id: "ask:a",
      kind: "question",
      status: "open",
      ask: {
        state: "in_progress",
        remaining: "",
        evidence: "",
        revision: 1,
        provenance: "explicit",
      },
    });
    expect(eyebrow).toEqual({ kind: "Ask", status: "In progress" });
    expect(JSON.stringify(eyebrow)).not.toMatch(/explicit/i);
  });

  it("separates inferred questions, notes, quotes and turn outcomes", () => {
    expect(label({ ...base, id: "turn:1", kind: "question", status: "reviewed" })).toEqual({
      kind: "Question (inferred)",
      status: "Reviewed",
    });
    expect(label({ ...base, id: "pin:1", kind: "pin" })).toEqual({ kind: "Pinned", status: "" });
    expect(label({ ...base, id: "pin:2", kind: "pin", sourceId: "msg:1" }).kind).toBe("Quote");
    expect(label({ ...base, id: "o:1", kind: "outcome", status: "completed" })).toEqual({
      kind: "Turn ended",
      status: "",
    });
    expect(
      label({
        ...base,
        id: "p:1",
        kind: "permission",
        requestId: "r",
        requestKind: "plan",
        status: "pending",
      }),
    ).toEqual({ kind: "Decision", status: "Awaiting your response" });
  });
});

describe("splitEntryText", () => {
  it("uses the first non-empty line as the headline", () => {
    expect(splitEntryText("\n  Ship the tag cloud  \n\nThen the quote card.\nAnd docs.")).toEqual({
      headline: "Ship the tag cloud",
      rest: "Then the quote card.\nAnd docs.",
    });
    expect(splitEntryText("one line")).toEqual({ headline: "one line", rest: "" });
    expect(splitEntryText("  \n ")).toEqual({ headline: "", rest: "" });
  });
});
