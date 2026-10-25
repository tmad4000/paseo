import { describe, expect, it } from "vitest";
import {
  appendStreamTags,
  normalizeStreamTag,
  parseStreamHashtags,
  segmentStreamHashtags,
  streamEntryTags,
} from "./stream-tags.js";

describe("parseStreamHashtags", () => {
  it("finds lowercase, de-duplicated tags in order", () => {
    expect(
      parseStreamHashtags("#Design review for #paseo, then #design again (#ux-copy)."),
    ).toEqual(["design", "paseo", "ux-copy"]);
    expect(parseStreamHashtags("#café and #日本")).toEqual(["café", "日本"]);
  });

  it("ignores code spans, fenced code, URLs, headings, numbers and mid-word #", () => {
    const text = [
      "Use `#notatag` inline and see https://example.com/page#anchor or www.x.io/#frag.",
      "```",
      "#include <stdio.h>",
      "```",
      "# Heading, issue #123, C# and a&#39;b, path/#x",
      "Keep #real",
    ].join("\n");
    expect(parseStreamHashtags(text)).toEqual(["real"]);
  });

  it("drops trailing separators and over-long tags", () => {
    expect(parseStreamHashtags("#done- #ok_")).toEqual(["done", "ok"]);
    expect(parseStreamHashtags(`#${"a".repeat(51)} #fine`)).toEqual(["fine"]);
  });
});

describe("tag helpers", () => {
  it("normalizes typed tags with or without #", () => {
    expect(normalizeStreamTag("  #Quotes ")).toBe("quotes");
    expect(normalizeStreamTag("12")).toBeNull();
    expect(normalizeStreamTag("two words")).toBeNull();
  });

  it("segments text so hashtags can render as links", () => {
    expect(segmentStreamHashtags("Ship #Tags now, not `#code`")).toEqual([
      { text: "Ship " },
      { text: "#Tags", tag: "tags" },
      { text: " now, not `#code`" },
    ]);
  });

  it("appends only missing tags", () => {
    expect(appendStreamTags("A quote #ideas", ["ideas", "#Quotes"])).toBe(
      "A quote #ideas\n\n#quotes",
    );
    expect(appendStreamTags("Plain", [])).toBe("Plain");
  });

  it("parses legacy notes lazily but never tags provider output", () => {
    const base = { timestamp: "t", text: "Remember #launch", truncated: false };
    expect(streamEntryTags({ ...base, id: "pin:1", kind: "pin" })).toEqual(["launch"]);
    expect(
      streamEntryTags({ ...base, id: "question:1", kind: "question", status: "open" }),
    ).toEqual(["launch"]);
    expect(streamEntryTags({ ...base, id: "turn:1", kind: "question", status: "open" })).toEqual(
      [],
    );
    expect(streamEntryTags({ ...base, id: "o:1", kind: "outcome", status: "completed" })).toEqual(
      [],
    );
    expect(streamEntryTags({ ...base, id: "pin:2", kind: "pin", tags: ["kept"] })).toEqual([
      "kept",
    ]);
  });
});
