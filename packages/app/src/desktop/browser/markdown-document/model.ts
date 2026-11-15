// A browser tab pointed at a raw Markdown document (a static server's `.md`
// URL, or any `text/markdown` response) shows Chromium's plain-text page. The
// pane reads that text back from the guest and renders it with the same
// Markdown renderer the file tabs use.

const MARKDOWN_PATH_PATTERN = /\.(md|markdown)$/i;
const MARKDOWN_CONTENT_TYPES = new Set(["text/markdown", "text/x-markdown"]);
const PLAIN_TEXT_CONTENT_TYPE = "text/plain";

// Matches the file tab's editable/preview ceiling; bigger documents stay raw.
export const MARKDOWN_DOCUMENT_MAX_CHARS = 1024 * 1024;

// Runs inside the guest page. Only Chromium's generated text viewer is read:
// an HTML page never qualifies, so the pane never re-renders site content.
// Static servers (python -m http.server among them) send text/markdown without
// a charset, and Chromium then decodes UTF-8 bytes as windows-1252 ("–" shows
// as "â€“"). When the page was not decoded as UTF-8, re-read the same URL and
// keep the UTF-8 reading only if the bytes are valid UTF-8.
export const MARKDOWN_DOCUMENT_PROBE_SCRIPT = `(async () => {
  const contentType = String(document.contentType || "").toLowerCase();
  if (!/^text\\/(plain|markdown|x-markdown)$/.test(contentType)) return null;
  const body = document.body;
  if (!body) return null;
  const pre = body.children.length === 1 && body.firstElementChild && body.firstElementChild.tagName === "PRE"
    ? body.firstElementChild
    : null;
  let text = String((pre || body).textContent || "");
  if (String(document.characterSet || "").toUpperCase() !== "UTF-8") {
    try {
      const response = await fetch(location.href, { cache: "force-cache", credentials: "same-origin" });
      if (response.ok) {
        text = new TextDecoder("utf-8", { fatal: true }).decode(await response.arrayBuffer());
      }
    } catch {}
  }
  return { contentType, text };
})()`;

export function isMarkdownDocumentUrl(url: string): boolean {
  try {
    return MARKDOWN_PATH_PATTERN.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** The Markdown source to render for a probe result, or null to keep the page as is. */
export function readMarkdownDocumentProbe(result: unknown, url: string): string | null {
  if (typeof result !== "object" || result === null) return null;
  const { contentType, text } = result as { contentType?: unknown; text?: unknown };
  if (typeof contentType !== "string" || typeof text !== "string") return null;
  if (text.length > MARKDOWN_DOCUMENT_MAX_CHARS) return null;
  if (MARKDOWN_CONTENT_TYPES.has(contentType)) return text;
  if (contentType === PLAIN_TEXT_CONTENT_TYPE && isMarkdownDocumentUrl(url)) return text;
  return null;
}

/**
 * Where a link pressed in the rendered document should go. Relative links
 * resolve against the document URL; only http(s) targets navigate the tab.
 */
export function resolveMarkdownDocumentLink(href: string, documentUrl: string): string | null {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  try {
    const target = new URL(trimmed, documentUrl);
    return target.protocol === "http:" || target.protocol === "https:" ? target.href : null;
  } catch {
    return null;
  }
}
