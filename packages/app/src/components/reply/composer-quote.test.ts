import { describe, expect, test } from "vitest";
import { buildReplyQuote, insertReplyQuote } from "./composer-quote";

describe("buildReplyQuote", () => {
  test("quotes every line and marks blank lines", () => {
    expect(buildReplyQuote("first line\n\nsecond line")).toBe("> first line\n>\n> second line");
  });

  test("returns nothing for an empty message", () => {
    expect(buildReplyQuote("  \n ")).toBe("");
  });

  test("normalizes Windows line endings", () => {
    expect(buildReplyQuote("a\r\nb")).toBe("> a\n> b");
  });

  test("cuts long messages at a word boundary with an ellipsis", () => {
    const quote = buildReplyQuote("word ".repeat(200), 50);
    expect(quote.startsWith("> word")).toBe(true);
    expect(quote.endsWith(" …")).toBe(true);
    expect(quote.length).toBeLessThanOrEqual(2 + 50 + 2);
    expect(quote).not.toMatch(/wor …$/);
  });

  test("hard-cuts a long message with no nearby boundary", () => {
    expect(buildReplyQuote("x".repeat(80), 10)).toBe(`> ${"x".repeat(10)} …`);
  });
});

describe("insertReplyQuote", () => {
  test("leaves an empty line for the reply when the composer is empty", () => {
    expect(insertReplyQuote({ currentText: "", quote: "> hi" })).toBe("> hi\n\n");
  });

  test("keeps the typed draft below the quote", () => {
    expect(insertReplyQuote({ currentText: "my draft", quote: "> hi" })).toBe("> hi\n\nmy draft");
  });

  test("does nothing for an empty quote", () => {
    expect(insertReplyQuote({ currentText: "draft", quote: "" })).toBe("draft");
  });
});
