/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import {
  MARKDOWN_DOCUMENT_MAX_CHARS,
  MARKDOWN_DOCUMENT_PROBE_SCRIPT,
  isMarkdownDocumentUrl,
  readMarkdownDocumentProbe,
  resolveMarkdownDocumentLink,
} from "./model";

function runProbe(input: {
  contentType: string;
  bodyHtml: string;
  characterSet?: string;
  fetchBytes?: Uint8Array | null;
}): Promise<unknown> {
  const page = document.implementation.createHTMLDocument("");
  page.body.innerHTML = input.bodyHtml;
  const guestDocument = {
    contentType: input.contentType,
    characterSet: input.characterSet ?? "UTF-8",
    body: page.body,
  };
  const guestFetch = async () => {
    if (!input.fetchBytes) throw new Error("offline");
    return { ok: true, arrayBuffer: async () => input.fetchBytes!.buffer };
  };
  const guestLocation = { href: "http://h/plan.md" };
  // The script runs in the guest as a bare expression against its globals.
  // oxlint-disable-next-line typescript/no-implied-eval -- evaluates the exported guest script in a fake guest scope
  const run = new Function(
    "document",
    "fetch",
    "location",
    `return ${MARKDOWN_DOCUMENT_PROBE_SCRIPT};`,
  );
  return run(guestDocument, guestFetch, guestLocation) as Promise<unknown>;
}

function preHtml(text: string): string {
  const pre = document.createElement("pre");
  pre.textContent = text;
  return pre.outerHTML;
}

describe("isMarkdownDocumentUrl", () => {
  it("matches .md and .markdown paths, ignoring query and hash", () => {
    expect(isMarkdownDocumentUrl("http://host:8064/storage-decision.md")).toBe(true);
    expect(isMarkdownDocumentUrl("https://host/notes/README.MD?raw=1#top")).toBe(true);
    expect(isMarkdownDocumentUrl("https://host/guide.markdown")).toBe(true);
  });

  it("rejects other paths and unparsable input", () => {
    expect(isMarkdownDocumentUrl("https://host/storage-decision.html")).toBe(false);
    expect(isMarkdownDocumentUrl("https://host/page?file=notes.md")).toBe(false);
    expect(isMarkdownDocumentUrl("not a url.md")).toBe(false);
  });
});

describe("MARKDOWN_DOCUMENT_PROBE_SCRIPT", () => {
  it("returns the exact text of Chromium's plain-text viewer", async () => {
    const text = "# Title\n\n| a | b |\n| - | - |\n| 1 | 2 |\n";
    await expect(runProbe({ contentType: "text/plain", bodyHtml: preHtml(text) })).resolves.toEqual(
      { contentType: "text/plain", text },
    );
  });

  it("does not read HTML pages", async () => {
    await expect(
      runProbe({ contentType: "text/html", bodyHtml: "<h1>Site</h1><script>x()</script>" }),
    ).resolves.toBeNull();
  });

  it("lowercases the content type it reports", async () => {
    await expect(
      runProbe({ contentType: "Text/Markdown", bodyHtml: "<pre># Hi</pre>" }),
    ).resolves.toEqual({ contentType: "text/markdown", text: "# Hi" });
  });

  it("re-reads UTF-8 bytes that Chromium decoded as windows-1252", async () => {
    const utf8 = new TextEncoder().encode("Cost: $1\u20133");
    await expect(
      runProbe({
        contentType: "text/markdown",
        characterSet: "windows-1252",
        bodyHtml: preHtml("Cost: $1\u00e2\u20ac\u201c3"),
        fetchBytes: utf8,
      }),
    ).resolves.toEqual({ contentType: "text/markdown", text: "Cost: $1\u20133" });
  });

  it("keeps the browser's decoding when the bytes are not UTF-8 or the re-read fails", async () => {
    const latin1 = new Uint8Array([0x63, 0x61, 0x66, 0xe9]);
    await expect(
      runProbe({
        contentType: "text/plain",
        characterSet: "windows-1252",
        bodyHtml: preHtml("caf\u00e9"),
        fetchBytes: latin1,
      }),
    ).resolves.toEqual({ contentType: "text/plain", text: "caf\u00e9" });
    await expect(
      runProbe({
        contentType: "text/plain",
        characterSet: "windows-1252",
        bodyHtml: preHtml("caf\u00e9"),
        fetchBytes: null,
      }),
    ).resolves.toEqual({ contentType: "text/plain", text: "caf\u00e9" });
  });
});

describe("readMarkdownDocumentProbe", () => {
  it("renders text/markdown from any URL", () => {
    expect(
      readMarkdownDocumentProbe({ contentType: "text/markdown", text: "# Hi" }, "https://h/raw"),
    ).toBe("# Hi");
    expect(
      readMarkdownDocumentProbe({ contentType: "text/x-markdown", text: "# Hi" }, "https://h/raw"),
    ).toBe("# Hi");
  });

  it("renders text/plain only for a Markdown file URL", () => {
    expect(
      readMarkdownDocumentProbe({ contentType: "text/plain", text: "# Hi" }, "https://h/a.md"),
    ).toBe("# Hi");
    expect(
      readMarkdownDocumentProbe({ contentType: "text/plain", text: "# Hi" }, "https://h/a.txt"),
    ).toBeNull();
  });

  it("keeps the page as is for missing, malformed or oversized results", () => {
    expect(readMarkdownDocumentProbe(null, "https://h/a.md")).toBeNull();
    expect(readMarkdownDocumentProbe({ contentType: "text/plain" }, "https://h/a.md")).toBeNull();
    expect(
      readMarkdownDocumentProbe({ contentType: "text/html", text: "<p>" }, "https://h/a.md"),
    ).toBeNull();
    expect(
      readMarkdownDocumentProbe(
        { contentType: "text/markdown", text: "x".repeat(MARKDOWN_DOCUMENT_MAX_CHARS + 1) },
        "https://h/a.md",
      ),
    ).toBeNull();
  });
});

describe("resolveMarkdownDocumentLink", () => {
  const documentUrl = "http://jacob-dev-1.example:8064/notes/plan.md";

  it("resolves relative links against the document", () => {
    expect(resolveMarkdownDocumentLink("./other.md", documentUrl)).toBe(
      "http://jacob-dev-1.example:8064/notes/other.md",
    );
    expect(resolveMarkdownDocumentLink("/index.html", documentUrl)).toBe(
      "http://jacob-dev-1.example:8064/index.html",
    );
  });

  it("keeps absolute http(s) links", () => {
    expect(resolveMarkdownDocumentLink("https://github.com/tmad4000/paseo", documentUrl)).toBe(
      "https://github.com/tmad4000/paseo",
    );
  });

  it("refuses script, file and in-page links", () => {
    expect(resolveMarkdownDocumentLink("javascript:alert(1)", documentUrl)).toBeNull();
    expect(resolveMarkdownDocumentLink("file:///etc/passwd", documentUrl)).toBeNull();
    expect(resolveMarkdownDocumentLink("#section", documentUrl)).toBeNull();
    expect(resolveMarkdownDocumentLink("  ", documentUrl)).toBeNull();
  });
});
