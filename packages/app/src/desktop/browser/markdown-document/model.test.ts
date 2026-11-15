/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import {
  MARKDOWN_DOCUMENT_MAX_CHARS,
  MARKDOWN_DOCUMENT_PROBE_SCRIPT,
  isMarkdownDocumentUrl,
  readMarkdownDocumentProbe,
  resolveMarkdownDocumentLink,
} from "./model";

interface ProbeInput {
  contentType: string;
  bodyHtml: string;
  characterSet?: string;
  pathname?: string;
  fetchBytes?: Uint8Array | null;
  contentLength?: string | null;
}

function runProbe(input: ProbeInput): {
  result: Promise<unknown>;
  fetch: ReturnType<typeof vi.fn>;
} {
  const page = document.implementation.createHTMLDocument("");
  page.body.innerHTML = input.bodyHtml;
  const guestDocument = {
    contentType: input.contentType,
    characterSet: input.characterSet ?? "UTF-8",
    body: page.body,
  };
  const guestFetch = vi.fn(async () => {
    if (!input.fetchBytes) throw new Error("offline");
    const bytes = input.fetchBytes;
    return {
      ok: true,
      headers: {
        get: (name: string) => (name === "content-length" ? (input.contentLength ?? null) : null),
      },
      arrayBuffer: async () => bytes.buffer,
    };
  });
  const pathname = input.pathname ?? "/plan.md";
  const guestLocation = { href: `http://h${pathname}`, pathname };
  // The script runs in the guest as a bare expression against its globals.
  // oxlint-disable-next-line typescript/no-implied-eval -- evaluates the exported guest script in a fake guest scope
  const run = new Function(
    "document",
    "fetch",
    "location",
    `return ${MARKDOWN_DOCUMENT_PROBE_SCRIPT};`,
  );
  return {
    result: run(guestDocument, guestFetch, guestLocation) as Promise<unknown>,
    fetch: guestFetch,
  };
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
  it("returns the exact text of Chromium's plain-text viewer on a .md path", async () => {
    const text = "# Title\n\n| a | b |\n| - | - |\n| 1 | 2 |\n";
    const probe = runProbe({ contentType: "text/plain", bodyHtml: preHtml(text) });
    await expect(probe.result).resolves.toEqual({ contentType: "text/plain", text });
    expect(probe.fetch).not.toHaveBeenCalled();
  });

  it("reads nothing from HTML pages or plain text outside a .md path", async () => {
    await expect(
      runProbe({ contentType: "text/html", bodyHtml: "<h1>Site</h1><script>x()</script>" }).result,
    ).resolves.toBeNull();
    const log = runProbe({
      contentType: "text/plain",
      characterSet: "windows-1252",
      pathname: "/server.log",
      bodyHtml: preHtml("line"),
      fetchBytes: new Uint8Array([0x6c]),
    });
    await expect(log.result).resolves.toBeNull();
    expect(log.fetch).not.toHaveBeenCalled();
  });

  it("accepts text/markdown on any path and lowercases the content type", async () => {
    await expect(
      runProbe({ contentType: "Text/Markdown", pathname: "/raw", bodyHtml: "<pre># Hi</pre>" })
        .result,
    ).resolves.toEqual({ contentType: "text/markdown", text: "# Hi" });
  });

  it("re-reads UTF-8 bytes that Chromium decoded as windows-1252", async () => {
    const probe = runProbe({
      contentType: "text/markdown",
      characterSet: "windows-1252",
      bodyHtml: preHtml("Cost: $1\u00e2\u20ac\u201c3"),
      fetchBytes: new TextEncoder().encode("Cost: $1\u20133"),
    });
    await expect(probe.result).resolves.toEqual({
      contentType: "text/markdown",
      text: "Cost: $1\u20133",
    });
    expect(probe.fetch).toHaveBeenCalledTimes(1);
  });

  it("re-reads only after a windows-1252 fallback, never for UTF-8 or other declared charsets", async () => {
    for (const characterSet of ["UTF-8", "UTF-16LE", "Shift_JIS"]) {
      const probe = runProbe({
        contentType: "text/markdown",
        characterSet,
        bodyHtml: preHtml("# Hi"),
        fetchBytes: new TextEncoder().encode("# Other"),
      });
      await expect(probe.result).resolves.toEqual({ contentType: "text/markdown", text: "# Hi" });
      expect(probe.fetch).not.toHaveBeenCalled();
    }
  });

  it("keeps the browser's decoding when the bytes are not UTF-8, too large, or the re-read fails", async () => {
    const base = {
      contentType: "text/plain",
      characterSet: "windows-1252",
      bodyHtml: preHtml("caf\u00e9"),
    };
    const expected = { contentType: "text/plain", text: "caf\u00e9" };
    await expect(
      runProbe({ ...base, fetchBytes: new Uint8Array([0x63, 0x61, 0x66, 0xe9]) }).result,
    ).resolves.toEqual(expected);
    await expect(runProbe({ ...base, fetchBytes: null }).result).resolves.toEqual(expected);
    await expect(
      runProbe({
        ...base,
        fetchBytes: new TextEncoder().encode("caf\u00e9"),
        contentLength: String(MARKDOWN_DOCUMENT_MAX_CHARS * 4 + 1),
      }).result,
    ).resolves.toEqual(expected);
  });

  it("reads nothing more for a document over the size cap", async () => {
    const probe = runProbe({
      contentType: "text/markdown",
      characterSet: "windows-1252",
      bodyHtml: preHtml("x".repeat(MARKDOWN_DOCUMENT_MAX_CHARS + 1)),
      fetchBytes: new TextEncoder().encode("x"),
    });
    await expect(probe.result).resolves.toBeNull();
    expect(probe.fetch).not.toHaveBeenCalled();
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

  it("does not reload the document for a link to one of its own sections", () => {
    expect(resolveMarkdownDocumentLink(`${documentUrl}#next-steps`, documentUrl)).toBeNull();
    expect(resolveMarkdownDocumentLink("./plan.md?x=1#a", documentUrl)).toBe(
      "http://jacob-dev-1.example:8064/notes/plan.md?x=1#a",
    );
  });

  it("refuses script, file and in-page links", () => {
    expect(resolveMarkdownDocumentLink("javascript:alert(1)", documentUrl)).toBeNull();
    expect(resolveMarkdownDocumentLink("file:///etc/passwd", documentUrl)).toBeNull();
    expect(resolveMarkdownDocumentLink("#section", documentUrl)).toBeNull();
    expect(resolveMarkdownDocumentLink("  ", documentUrl)).toBeNull();
  });
});
