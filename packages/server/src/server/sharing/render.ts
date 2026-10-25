import { createHash } from "node:crypto";
import MarkdownIt from "markdown-it";
import type { ShareSnapshot, SharedMessage } from "@getpaseo/protocol/sharing";
import { escapeHtml, sharePageShell } from "./view/page.js";
export { SHARE_CSP, SHARE_CSS } from "./view/page.js";

export const MAX_SHARE_MESSAGES = 500;
export const MAX_SHARE_HTML_BYTES = 2 * 1024 * 1024;
export interface ShareBytes {
  html: Buffer;
  json: Buffer;
}
export interface PreparedShareSnapshot extends ShareBytes {
  snapshot: ShareSnapshot;
}

const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false });
markdown.disable("image");
markdown.renderer.rules.link_open = (tokens, index, options, _env, renderer) => {
  tokens[index]!.attrSet("rel", "noopener noreferrer nofollow");
  return renderer.renderToken(tokens, index, options);
};
export function renderSharePage(snapshot: ShareSnapshot): string {
  const messages = snapshot.messages
    .map((message) => {
      if (message.kind === "omitted") {
        if (message.reason === "earlier")
          return `<div class="omitted">${message.count} earlier ${message.count === 1 ? "message is" : "messages are"} not included in this snapshot</div>`;
        let label = `message${message.count === 1 ? "" : "s"} excluded`;
        if (message.reason === "tool_calls")
          label = `tool call${message.count === 1 ? "" : "s"} hidden`;
        if (message.reason === "reasoning")
          label = `reasoning ${message.count === 1 ? "entry" : "entries"} hidden`;
        return `<div class="omitted">${message.count} ${label}</div>`;
      }
      const author = message.kind === "user" ? message.author.name : "Assistant";
      return `<article class="message"><div class="author">${escapeHtml(author)}</div>${markdown.render(message.text)}</article>`;
    })
    .join("");
  return sharePageShell(
    `<header><div class="eyebrow">PASEO · SHARED CONVERSATION</div><h1>${escapeHtml(snapshot.title)}</h1><div class="meta">${escapeHtml(snapshot.owner.name)} · ${escapeHtml(snapshot.agent.provider)}${snapshot.agent.model ? ` · ${escapeHtml(snapshot.agent.model)}` : ""} · ${escapeHtml(snapshot.createdAt.slice(0, 10))}</div></header>${messages}<footer>Shared read-only with Paseo · Snapshot · Shared view, tool activity hidden</footer>`,
  );
}

function finish(snapshot: ShareSnapshot, html: Buffer): PreparedShareSnapshot {
  const { createdAt: _createdAt, sourceDigest: _digest, ...content } = snapshot;
  const value = {
    ...snapshot,
    sourceDigest: createHash("sha256").update(JSON.stringify(content)).digest("hex"),
  };
  return { snapshot: value, html, json: Buffer.from(JSON.stringify(value, null, 2)) };
}

/** Owner-triggered metadata edits retain the immutable message list. */
export function renderShareArtifacts(snapshot: ShareSnapshot): PreparedShareSnapshot {
  const first = snapshot.messages[0];
  const rows =
    snapshot.messages.length - (first?.kind === "omitted" && first.reason === "earlier" ? 1 : 0);
  if (rows > MAX_SHARE_MESSAGES)
    throw new Error("Stored snapshot exceeds the row limit; create a new link");
  const html = Buffer.from(renderSharePage(snapshot));
  if (html.byteLength > MAX_SHARE_HTML_BYTES)
    throw new Error("Share metadata exceeds the snapshot HTML size limit");
  return finish(snapshot, html);
}

/** Preview and create use exactly the same latest-row and rendered-byte budgets. */
export function prepareShareSnapshot(snapshot: ShareSnapshot): PreparedShareSnapshot {
  const previous = snapshot.messages[0];
  const earlier =
    previous?.kind === "omitted" && previous.reason === "earlier" ? previous : undefined;
  const messages = earlier ? snapshot.messages.slice(1) : snapshot.messages;
  const latest = messages.slice(-MAX_SHARE_MESSAGES);
  const initiallyDropped = (earlier?.count ?? 0) + messages.length - latest.length;
  const retainedIds = new Set(latest.map((message) => message.id));
  let id = "share_earlier";
  while (retainedIds.has(id)) id += "_";
  const at = earlier?.at ?? messages[0]?.at ?? snapshot.createdAt;
  const candidate = (keep: number): ShareSnapshot => {
    const count = initiallyDropped + latest.length - keep;
    const prefix: SharedMessage[] = count
      ? [{ kind: "omitted", reason: "earlier", id, at, count }]
      : [];
    return { ...snapshot, messages: [...prefix, ...latest.slice(latest.length - keep)] };
  };
  let value = candidate(latest.length);
  let html = Buffer.from(renderSharePage(value));
  if (html.byteLength <= MAX_SHARE_HTML_BYTES) return finish(value, html);

  // After at least one omission, each removed row saves more than count-label growth.
  // Find the largest suffix that fits without rendering up to 500 growing candidates.
  let low = 0;
  let high = latest.length - 1;
  let best: { snapshot: ShareSnapshot; html: Buffer } | undefined;
  while (low <= high) {
    const keep = Math.floor((low + high) / 2);
    value = candidate(keep);
    html = Buffer.from(renderSharePage(value));
    if (html.byteLength <= MAX_SHARE_HTML_BYTES) {
      best = { snapshot: value, html };
      low = keep + 1;
    } else high = keep - 1;
  }
  if (!best) throw new Error("Share metadata exceeds the snapshot HTML size limit");
  return finish(best.snapshot, best.html);
}
