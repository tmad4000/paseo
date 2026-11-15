import type MarkdownIt from "markdown-it";
import { createMarkdownParser } from "@/utils/markdown-parser";

// Markdown read from a browser tab is web content: anything in it is hostile.
// The app renders it outside the guest, so the parser itself decides what may
// become a link or an image, before the shared renderer sees a token.
//
// - Links and images resolve against the document URL.
// - Only http(s) links survive. `paseo://` session links, `javascript:`,
//   `file:` and the rest render as plain text, so they never reach the
//   renderer's session-link or external-open paths.
// - Images load from the app, not the guest, so only same-origin http(s)
//   images and inline data images are kept; others render as their alt text.

const INLINE_IMAGE_DATA_PATTERN = /^data:image\/(gif|png|jpeg|webp);/i;

function resolveAgainst(url: string, documentUrl: string): URL | null {
  try {
    return new URL(url.trim(), documentUrl);
  } catch {
    return null;
  }
}

function isHttpUrl(url: URL): boolean {
  return url.protocol === "http:" || url.protocol === "https:";
}

export function createBrowserMarkdownParser(documentUrl: string): MarkdownIt {
  const parser = createMarkdownParser({ linkify: true });
  const documentOrigin = resolveAgainst(documentUrl, documentUrl)?.origin ?? null;
  const normalizeLink = parser.normalizeLink.bind(parser);

  parser.normalizeLink = (url) => {
    if (INLINE_IMAGE_DATA_PATTERN.test(url.trim())) return normalizeLink(url);
    const resolved = resolveAgainst(url, documentUrl);
    return normalizeLink(resolved ? resolved.href : url);
  };
  parser.validateLink = (url) => {
    if (INLINE_IMAGE_DATA_PATTERN.test(url.trim())) return true;
    const resolved = resolveAgainst(url, documentUrl);
    return resolved !== null && isHttpUrl(resolved);
  };

  parser.core.ruler.push("browser_document_images", (state) => {
    for (const block of state.tokens) {
      for (const token of block.children ?? []) {
        if (token.type !== "image") continue;
        const src = token.attrGet("src") ?? "";
        if (INLINE_IMAGE_DATA_PATTERN.test(src)) continue;
        const resolved = resolveAgainst(src, documentUrl);
        if (resolved && isHttpUrl(resolved) && resolved.origin === documentOrigin) continue;
        token.type = "text";
        token.tag = "";
        token.attrs = null;
        token.children = null;
      }
    }
  });

  return parser;
}
