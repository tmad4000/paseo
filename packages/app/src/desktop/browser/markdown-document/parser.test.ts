import { describe, expect, it } from "vitest";
import { createBrowserMarkdownParser } from "./parser";

const documentUrl = "http://docs.example:8064/notes/plan.md";

function inlineTokens(markdown: string) {
  const parser = createBrowserMarkdownParser(documentUrl);
  return parser.parse(markdown, {}).flatMap((token) => token.children ?? []);
}

function linkHrefs(markdown: string): string[] {
  return inlineTokens(markdown)
    .filter((token) => token.type === "link_open")
    .map((token) => token.attrGet("href") ?? "");
}

function imageSrcs(markdown: string): string[] {
  return inlineTokens(markdown)
    .filter((token) => token.type === "image")
    .map((token) => token.attrGet("src") ?? "");
}

describe("createBrowserMarkdownParser", () => {
  it("resolves relative links against the document and keeps http(s) links", () => {
    expect(
      linkHrefs("[a](./other.md) [b](/top.md) [c](https://github.com/tmad4000/paseo)"),
    ).toEqual([
      "http://docs.example:8064/notes/other.md",
      "http://docs.example:8064/top.md",
      "https://github.com/tmad4000/paseo",
    ]);
  });

  it("renders session, script, file and data links as plain text", () => {
    const markdown =
      "[s](paseo://srv_x/agent/abc) [f](paseo-fork://srv_x/agent/abc) [j](javascript:alert(1)) [l](file:///etc/passwd) [d](data:text/html,x)";
    expect(linkHrefs(markdown)).toEqual([]);
    expect(
      inlineTokens(markdown)
        .filter((token) => token.type === "text")
        .map((token) => token.content)
        .join(""),
    ).toContain("[s](paseo://srv_x/agent/abc)");
  });

  it("keeps same-origin and inline data images, resolved against the document", () => {
    expect(
      imageSrcs(
        "![a](./diagram.png) ![b](http://docs.example:8064/b.png) ![c](data:image/png;base64,AAAA)",
      ),
    ).toEqual([
      "http://docs.example:8064/notes/diagram.png",
      "http://docs.example:8064/b.png",
      "data:image/png;base64,AAAA",
    ]);
  });

  it("drops empty and unrenderable data images instead of fetching a bogus host", () => {
    expect(imageSrcs("![e]() ![w](data:image/webp;base64,AAAA)")).toEqual([]);
  });

  it("drops cross-origin images to their alt text", () => {
    const tokens = inlineTokens(
      "![tracker](https://evil.example/pixel.gif) ![lan](http://10.0.0.1/x.png)",
    );
    expect(tokens.filter((token) => token.type === "image")).toEqual([]);
    expect(tokens.map((token) => token.content).join("")).toContain("tracker");
  });

  it("keeps the app parser's settings: no raw HTML", () => {
    const html = createBrowserMarkdownParser(documentUrl).render("<script>x()</script>");
    expect(html).not.toContain("<script>");
  });
});
