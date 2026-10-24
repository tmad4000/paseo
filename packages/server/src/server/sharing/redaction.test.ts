import { describe, expect, it } from "vitest";
import { DEFAULT_REDACTION } from "@getpaseo/protocol/sharing";
import type { AgentTimelineItem } from "../agent/agent-sdk-types.js";
import { redactTimeline, SECRET_PATTERNS } from "./redaction.js";

const metadata = {
  title: "A conversation",
  ownerName: "Jacob",
  provider: "mock",
  createdAt: "2026-10-24T12:00:00Z",
};
const rows = (items: AgentTimelineItem[]) =>
  items.map((item, index) => ({ seq: index + 1, timestamp: metadata.createdAt, item }));
export const secretFixtures = [
  "-----BEGIN RSA PRIVATE KEY-----\nabc123\n-----END RSA PRIVATE KEY-----",
  "Bearer abcdefghijklmnopqrstuvwxyz123456",
  "?access_token=super-secret-value",
  "password=super-secret-value",
  "sk-1234567890abcdefghijklmnop",
  "ghp_1234567890abcdefghijklmnop",
  "AKIA1234567890ABCDEF",
  "xoxb-1234567890-abcdefghijk",
  "AIza1234567890abcdefghijklmnop",
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghij123456",
  "token: abcdef0123456789abcdef0123456789",
  "abcdef0123456789abcdef0123456789 : secret",
];
describe("share redaction", () => {
  it("keeps redaction markers stable even when an extra literal matches marker text", () => {
    const profile = { ...DEFAULT_REDACTION, extraPatterns: ["secret", "email"] };
    const first = redactTimeline(
      rows([{ type: "user_message", text: "secret and email" }]),
      metadata,
      profile,
    );
    const second = redactTimeline(
      rows([
        {
          type: "user_message",
          text: first.messages[0]!.kind === "user" ? first.messages[0]!.text : "",
        },
      ]),
      metadata,
      profile,
    );
    expect(second.messages).toEqual(first.messages);
  });
  it.each(secretFixtures.map((fixture, index) => [SECRET_PATTERNS[index]!.name, fixture]))(
    "masks %s in user and assistant text",
    (_name, fixture) => {
      const result = redactTimeline(
        rows([
          { type: "user_message", text: fixture! },
          { type: "assistant_message", text: fixture! },
        ]),
        metadata,
      );
      expect(result.redactionSummary.secretsMasked).toBe(2);
      expect(JSON.stringify(result)).not.toContain(fixture!);
      expect(
        result.messages.every(
          (message) => message.kind !== "omitted" && message.text.includes("[secret hidden]"),
        ),
      ).toBe(true);
    },
  );
  it.each([
    "sk-ant-api03-1234567890abcdefghijk",
    "gho_1234567890abcdefghijklmnop",
    "github_pat_1234567890abcdefghijklmnop",
    "passwd: 'my secret'",
    "?sig=signature&key=abc",
  ])("masks additional secret fixture %s", (text) => {
    const result = redactTimeline(rows([{ type: "user_message", text }]), metadata);
    expect(result.redactionSummary.secretsMasked).toBeGreaterThan(0);
    expect(JSON.stringify(result.messages)).not.toContain(text);
  });
  it("filters tools and reasoning, counts omissions and never projects tool payloads", () => {
    const items: AgentTimelineItem[] = [];
    for (let i = 0; i < 3; i++)
      items.push(
        { type: "user_message", text: `prompt ${i}` },
        { type: "assistant_message", text: `reply ${i}`, messageId: `reply${i}` },
      );
    for (let i = 0; i < 12; i++)
      items.push({
        type: "tool_call",
        callId: `tool${i}`,
        name: "dangerous-name",
        status: "completed",
        error: null,
        detail: { type: "unknown", input: "argument-secret", output: "output-secret" },
      });
    for (let i = 0; i < 4; i++)
      items.push({ type: "reasoning", text: `hidden-thought${i}` }, { type: "todo", items: [] });
    items.push({ type: "error", message: "private-error" });
    const result = redactTimeline(rows(items), metadata);
    expect(result.messages.filter((m) => m.kind !== "omitted")).toHaveLength(6);
    expect(result.redactionSummary.hiddenToolCalls).toBe(12);
    expect(result.redactionSummary.hiddenReasoning).toBe(4);
    expect(
      result.messages.filter((m) => m.kind === "omitted").reduce((sum, m) => sum + m.count, 0),
    ).toBe(16);
    const included = redactTimeline(rows(items), metadata, {
      ...DEFAULT_REDACTION,
      include: { toolCalls: true, reasoning: false, errors: false },
    });
    for (const value of [
      "dangerous-name",
      "argument-secret",
      "output-secret",
      "private-error",
      "hidden-thought",
    ])
      expect(JSON.stringify(included)).not.toContain(value);
    expect(JSON.stringify(included)).toContain("Used a tool");
  });
  it("collapses absolute paths including fenced code, preserves relative paths and masks contacts", () => {
    const text =
      "/Users/jacob/code/paseo-fork/packages/server/src/x.ts ~/.paseo/config.json packages/app/src/x.tsx\n```\nC:\\Users\\Jacob\\src\\x.ts /tmp/private/src/y.ts\n```\nhello@example.com +14155552671 Jacob";
    const result = redactTimeline(rows([{ type: "user_message", text }]), metadata);
    expect(result.messages[0]).toMatchObject({
      text: "…/src/x.ts …/.paseo/config.json packages/app/src/x.tsx\n```\n…/src/x.ts …/src/y.ts\n```\n[email] [phone] Jacob",
    });
    expect(result.redactionSummary.pathsCollapsed).toBe(4);
    expect(result.redactionSummary.contactsMasked).toBe(2);
  });
  it("excludes stable message ids and masks literal extra patterns", () => {
    const result = redactTimeline(
      rows([
        { type: "user_message", messageId: "hide", text: "private" },
        { type: "assistant_message", text: "keep [literal].*" },
      ]),
      metadata,
      { ...DEFAULT_REDACTION, excludedMessageIds: ["hide"], extraPatterns: ["[literal].*"] },
    );
    expect(result.messages).toMatchObject([
      { kind: "omitted", reason: "excluded", count: 1 },
      { text: "keep [secret hidden]" },
    ]);
    expect(result.redactionSummary.messagesExcluded).toBe(1);
  });
  it("does not change already scrubbed message text on another pass", () => {
    const first = redactTimeline(
      rows([
        {
          type: "assistant_message",
          text: `${secretFixtures.join("\n")} /Users/jacob/src/x.ts hello@example.com`,
        },
      ]),
      metadata,
    );
    const second = redactTimeline(
      rows(
        first.messages.flatMap((m) =>
          m.kind === "omitted" ? [] : [{ type: "assistant_message" as const, text: m.text }],
        ),
      ),
      metadata,
    );
    expect(second.messages).toEqual(first.messages);
    expect(second.redactionSummary.secretsMasked).toBe(0);
  });
  it("scrubs title and includes reasoning/errors only when requested", () => {
    const result = redactTimeline(
      rows([
        { type: "reasoning", text: "hello@example.com" },
        { type: "notification", level: "error", message: "password=hidden" },
      ]),
      { ...metadata, title: "password=hidden" },
      { ...DEFAULT_REDACTION, include: { reasoning: true, errors: true, toolCalls: false } },
    );
    expect(result.title).toBe("[secret hidden]");
    expect(result.messages).toMatchObject([{ text: "[email]" }, { text: "[secret hidden]" }]);
  });
});
