import { describe, expect, it } from "vitest";
import { createMarkdownParser } from "./markdown-parser";

// Every string markdown-it's typographer would rewrite, with the character it
// would rewrite it to. Sourced from markdown-it/lib/rules_core/replacements.mjs
// and smartquotes.mjs. `--flag` is deliberately absent: the en-dash rules need
// whitespace or a word character on both sides, so a CLI flag after a space is
// never touched and asserting on it would prove nothing.
const REWRITTEN_BY_TYPOGRAPHER = [
  "(c)",
  "(C)",
  "(r)",
  "(R)",
  "(tm)",
  "(TM)",
  "+-",
  "two dots .. here",
  "wait for it...",
  "what????",
  "stop!!!!",
  "hmm,, ok",
  "a -- b",
  "word--word",
  "a --- b",
  'run --name="my repo"',
  "it's fine",
];

describe("createMarkdownParser", () => {
  it("preserves exact Markdown HTML across parser upgrades", () => {
    const parser = createMarkdownParser({ linkify: true });
    const markdown = [
      "# Heading",
      "",
      "Paragraph **bold** *emphasis* ~~deleted~~ and `literal --flag=1`.",
      "",
      "> Quoted text",
      "",
      "- Parent",
      "  - Child",
      "",
      "3. Third",
      "4. Fourth",
      "",
      "| Name | Value |",
      "| :--- | ---: |",
      "| one | two |",
      "",
      "```ts",
      'const html = "<tag>";',
      "```",
      "",
      '<script>alert("x")</script>',
      "",
      "[safe](https://example.com?a=1&b=2)",
      "![image](https://example.com/image.png)",
      "[blocked](javascript:alert(1))",
      "",
      'Copy "quotes", (c), a -- b and ... unchanged.',
      "",
      "Visit https://example.com or email user@example.com.",
    ].join("\n");
    expect(parser.render(markdown)).toMatchSnapshot("app Markdown HTML");
  });
  it("renders every typographer-rewritten sequence verbatim", () => {
    const parser = createMarkdownParser({ linkify: true });

    // markdown-it 14 no longer rewrites (p)/(P), but its literal output must stay copyable.
    for (const source of ["(p)", "(P)", ...REWRITTEN_BY_TYPOGRAPHER]) {
      expect(parser.renderInline(source)).toBe(escapeHtml(source));
    }
  });

  it("would fail if typographer were switched back on", () => {
    // Guards the assertion above: proves the fixture actually exercises the
    // rules, so a future refactor can't quietly make the test vacuous.
    const typographer = createMarkdownParser({ linkify: true });
    typographer.set({ typographer: true });

    for (const source of REWRITTEN_BY_TYPOGRAPHER) {
      expect(typographer.renderInline(source)).not.toBe(escapeHtml(source));
    }
  });

  it("rejects file:// links", () => {
    const parser = createMarkdownParser({ linkify: true });

    expect(parser.render("[open](file:///tmp/a.ts)")).not.toContain("href");
  });

  it("rejects javascript: links", () => {
    const parser = createMarkdownParser({ linkify: true });

    expect(parser.render("[x](javascript:alert(1))")).not.toContain("href");
  });

  it("linkifies bare URLs only when asked", () => {
    expect(createMarkdownParser({ linkify: true }).render("see https://paseo.sh now")).toContain(
      'href="https://paseo.sh"',
    );
    expect(
      createMarkdownParser({ linkify: false }).render("see https://paseo.sh now"),
    ).not.toContain("href");
  });
});

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
}
