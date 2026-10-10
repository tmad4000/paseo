/**
 * A `ui.command` browser target may name a page instead of an existing browser: a checklist,
 * a dashboard, a preview. Browser ids are UUID v4 (see browser-automation/rpc-schemas.ts), so
 * the id for a page is derived from its URL. The same URL always yields the same id on the
 * daemon, the CLI and every client, which makes "open this page beside me" idempotent and lets
 * a close by URL find the tab it opened.
 */

/** Absolute http(s) URLs only; anything else is not a page an agent may put in front of the user. */
export function normalizeUiBrowserUrl(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** FNV-1a over UTF-16 code units with a given offset basis, as an unsigned 32-bit integer. */
function fnv1a32(text: string, basis: number): number {
  let hash = basis >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function hex8(value: number): string {
  return value.toString(16).padStart(8, "0");
}

/**
 * A stable UUID-v4-shaped id for a page URL. Not a security boundary: it only names the tab.
 */
export function browserIdForUrl(url: string): string {
  const words = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b].map((basis) =>
    hex8(fnv1a32(`${basis}:${url}`, basis)),
  );
  const raw = words.join("");
  const variant = ((parseInt(raw[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  return [
    raw.slice(0, 8),
    raw.slice(8, 12),
    `4${raw.slice(13, 16)}`,
    `${variant}${raw.slice(17, 20)}`,
    raw.slice(20, 32),
  ].join("-");
}
