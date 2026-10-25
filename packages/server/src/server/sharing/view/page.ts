// Keep this shell and its security policy free of Markdown dependencies for the guest listener.
import { createHash } from "node:crypto";
export const escapeHtml = (text: string): string =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
export const SHARE_CSS = `:root{color-scheme:light dark;--bg:#fff;--fg:#202126;--muted:#6c707a;--line:#e6e7eb;--surface:#f6f7f9}@media(prefers-color-scheme:dark){:root{--bg:#151619;--fg:#e5e6eb;--muted:#a0a4b0;--line:#303239;--surface:#202228}}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:800px;margin:auto;padding:32px 20px}header{padding:0 0 24px;border-bottom:1px solid var(--line)}h1{font-size:26px;line-height:1.3;letter-spacing:-.6px;margin:12px 0}h2{font-size:22px}h3{font-size:18px}.eyebrow,footer,.meta,.omitted,.author{color:var(--muted);font-size:13px}.eyebrow{font-weight:600;letter-spacing:.04em}.message{padding:24px 0;border-bottom:1px solid var(--line);overflow-wrap:anywhere}.author{font-weight:600}.message p:last-child{margin-bottom:0}.omitted{padding:12px 0;border-bottom:1px solid var(--line)}pre{background:var(--surface);padding:16px;border:1px solid var(--line);border-radius:6px;overflow:auto}code{font:13px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace}blockquote{border-left:3px solid var(--line);margin-left:0;padding-left:16px}a{color:light-dark(#315fbd,#94b8ff)}table{border-collapse:collapse;display:block;overflow:auto}td,th{padding:8px;border:1px solid var(--line)}footer{padding-top:24px}button,a{touch-action:manipulation}@media(min-width:700px){main{padding:48px 32px}h1{font-size:30px}}`;
export const SHARE_CSP = `default-src 'none'; style-src 'sha256-${createHash("sha256").update(SHARE_CSS).digest("base64")}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
export function sharePageShell(content: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Shared conversation</title><style>${SHARE_CSS}</style></head><body><main>${content}</main></body></html>`;
}
export function unavailablePage(): string {
  return sharePageShell("<h1>This share isn’t available</h1>");
}
