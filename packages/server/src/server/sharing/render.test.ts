import { describe, expect, it } from "vitest";
import type { ShareSnapshot, SharedMessage } from "@getpaseo/protocol/sharing";
import {
  MAX_SHARE_HTML_BYTES,
  prepareShareSnapshot,
  renderShareArtifacts,
  renderSharePage,
} from "./render.js";

const at = "2026-10-24T12:00:00Z";
const snapshot = (messages: SharedMessage[]): ShareSnapshot => ({
  v: 1,
  title: "Private project launch",
  owner: { name: "Owner" },
  agent: { provider: "mock" },
  createdAt: at,
  messages,
  redactionSummary: {
    hiddenToolCalls: 0,
    hiddenReasoning: 0,
    secretsMasked: 0,
    hostsMasked: 0,
    pathsCollapsed: 0,
    contactsMasked: 0,
    messagesExcluded: 0,
  },
});
const message = (i: number, text = `Message ${i}`): SharedMessage => ({
  kind: "assistant",
  id: `m${i}`,
  at,
  text,
});

describe("prepared share snapshots", () => {
  it.each([0, 500, 501, 5000])("retains the latest 500 rows from %i messages", (length) => {
    const input = snapshot(Array.from({ length }, (_, i) => message(i)));
    const prepared = prepareShareSnapshot(input);
    const dropped = Math.max(0, length - 500);
    expect(prepared.snapshot.messages).toEqual([
      ...(dropped
        ? [{ kind: "omitted", reason: "earlier", count: dropped, id: "share_earlier", at }]
        : []),
      ...input.messages.slice(-500),
    ]);
    expect(JSON.parse(prepared.json.toString())).toEqual(prepared.snapshot);
    expect(prepared.html.toString()).toBe(renderSharePage(prepared.snapshot));
    expect(prepared.html.byteLength).toBeLessThanOrEqual(MAX_SHARE_HTML_BYTES);
    expect(prepareShareSnapshot(prepared.snapshot)).toEqual(prepared);
    if (dropped)
      expect(prepared.html.toString()).toContain(
        `${dropped} earlier ${dropped === 1 ? "message is" : "messages are"} not included in this snapshot`,
      );
  });
  it("counts omitted rows toward the budget, rather than their grouped message counts", () => {
    const prepared = prepareShareSnapshot(
      snapshot(
        Array.from({ length: 501 }, (_, i) => ({
          kind: "omitted",
          id: `m${i}`,
          at,
          reason: "tool_calls",
          count: 999,
        })),
      ),
    );
    expect(prepared.snapshot.messages).toHaveLength(501);
    expect(prepared.snapshot.messages[0]).toMatchObject({ reason: "earlier", count: 1 });
    expect(prepared.snapshot.messages[1]).toMatchObject({ id: "m1", count: 999 });
  });
  it("drops only the oldest rows until rendered UTF-8 HTML fits 2 MiB", () => {
    const large = "🦉".repeat(300000);
    const input = snapshot([message(0, large), message(1, large), message(2, "latest")]);
    const prepared = prepareShareSnapshot(input);
    expect(prepared.html.byteLength).toBeLessThanOrEqual(MAX_SHARE_HTML_BYTES);
    expect(prepared.snapshot.messages).toMatchObject([
      { reason: "earlier", count: 1 },
      { id: "m1" },
      { id: "m2" },
    ]);
    expect(Buffer.byteLength(renderSharePage(input))).toBeGreaterThan(MAX_SHARE_HTML_BYTES);
    expect(JSON.parse(prepared.json.toString()).messages).toEqual(prepared.snapshot.messages);
  });
  it("can omit a single oversized message and does not double-count on repeated preparation", () => {
    const prepared = prepareShareSnapshot(snapshot([message(0, "x".repeat(MAX_SHARE_HTML_BYTES))]));
    expect(prepared.snapshot.messages).toMatchObject([
      { kind: "omitted", reason: "earlier", count: 1 },
    ]);
    expect(prepareShareSnapshot(prepared.snapshot)).toEqual(prepared);
  });
  it("avoids a collision with the omission row id", () => {
    const input = Array.from({ length: 501 }, (_, i) => message(i));
    input[500] = { ...input[500]!, id: "share_earlier" };
    expect(prepareShareSnapshot(snapshot(input)).snapshot.messages[0]!.id).toBe("share_earlier_");
  });
  it("uses a generic head title, with the real title only in the body h1", () => {
    const html = renderSharePage(snapshot([]));
    const head = html.split("</head>")[0]!;
    expect(head).toContain("<title>Shared conversation</title>");
    expect(head).not.toContain("Private project launch");
    expect(head).not.toMatch(/description|og:/);
    expect(html).toContain("<h1>Private project launch</h1>");
  });
  it("refuses to publish an unbounded legacy message list through a title edit", () => {
    const messages = Array.from({ length: 501 }, (_, i) => message(i));
    expect(() => renderShareArtifacts(snapshot(messages))).toThrow("row limit");
  });
  it("rejects metadata that cannot fit even after every message is omitted", () => {
    expect(() =>
      prepareShareSnapshot({ ...snapshot([message(0)]), title: "x".repeat(MAX_SHARE_HTML_BYTES) }),
    ).toThrow("size limit");
  });
});
