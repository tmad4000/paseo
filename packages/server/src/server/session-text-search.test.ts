import { expect, test, vi } from "vitest";
import { SessionTextSearchHitSchema } from "@getpaseo/protocol/messages";
import {
  buildSessionTextSnippet,
  searchSessionText,
  type SessionTextSearchCandidate,
  type SessionTextSearchMessage,
} from "./session-text-search.js";

function candidate(agentId: string, activityAt: string): SessionTextSearchCandidate {
  return {
    agentId,
    workspaceId: `${agentId}-workspace`,
    workspaceTitle: `${agentId} workspace`,
    projectName: "tmpworkspace",
    title: `${agentId} title`,
    provider: "claude",
    activityAt,
  };
}

function reader(messages: Record<string, SessionTextSearchMessage[]>) {
  return vi.fn(async (agentId: string) => messages[agentId] ?? []);
}

test("matches case- and width-insensitively and returns verbatim snippets with offsets", async () => {
  const result = await searchSessionText({
    query: "  ＲＥＬＡＹ   reconnect ",
    candidates: [candidate("chat", "2026-10-01T00:00:00Z")],
    readMessages: reader({
      chat: [
        {
          text: "We traced the Relay\n reconnect loop to the heartbeat.",
          role: "assistant",
          timestamp: "2026-10-01T12:00:00Z",
          seq: 42,
        },
      ],
    }),
  });
  expect(result).toMatchObject({ searchedCount: 1, totalCount: 1, truncated: false });
  const [hit] = result.hits;
  expect(SessionTextSearchHitSchema.parse(hit)).toEqual(hit);
  expect(hit).toMatchObject({
    agentId: "chat",
    workspaceTitle: "chat workspace",
    projectName: "tmpworkspace",
    role: "assistant",
    snippet: "We traced the Relay reconnect loop to the heartbeat.",
    timestamp: "2026-10-01T12:00:00Z",
    seq: 42,
  });
  expect(hit!.snippet.slice(hit!.matchStart, hit!.matchStart + hit!.matchLength)).toBe(
    "Relay reconnect",
  );
});

test("reads the most recently active sessions first, caps hits per session, and orders by recency", async () => {
  const messages = (prefix: string, count: number): SessionTextSearchMessage[] =>
    Array.from({ length: count }, (_, index) => ({
      text: `${prefix} mention of queue ${index}`,
      role: "user" as const,
      timestamp: `2026-10-0${index + 1}T00:00:00Z`,
    }));
  const readMessages = reader({ older: messages("older", 2), newer: messages("newer", 5) });
  const result = await searchSessionText({
    query: "queue",
    candidates: [candidate("older", "2026-09-01T00:00:00Z"), candidate("newer", "2026-10-01T00:00:00Z")],
    readMessages,
  });
  expect(readMessages.mock.calls.map(([agentId]) => agentId)).toEqual(["newer", "older"]);
  expect(result.hits.map((hit) => `${hit.agentId}:${hit.timestamp?.slice(0, 10)}`)).toEqual([
    "newer:2026-10-05",
    "newer:2026-10-04",
    "newer:2026-10-03",
    "older:2026-10-02",
    "older:2026-10-01",
  ]);
});

test("stops at the time budget and the session and hit caps and reports truncation", async () => {
  let clock = 0;
  const readMessages = vi.fn(async () => {
    clock += 600;
    return [{ text: "needle", role: "user" as const }];
  });
  const candidates = ["a", "b", "c"].map((id) => candidate(id, "2026-10-01T00:00:00Z"));
  const timed = await searchSessionText({
    query: "needle",
    candidates,
    readMessages,
    now: () => clock,
  });
  expect(timed).toMatchObject({ searchedCount: 2, totalCount: 3, truncated: true });

  const capped = await searchSessionText({
    query: "needle",
    candidates,
    readMessages: reader({ a: [{ text: "needle", role: "user" }] }),
    limits: { maxSessions: 2 },
  });
  expect(capped).toMatchObject({ searchedCount: 2, totalCount: 3, truncated: true });

  const fewHits = await searchSessionText({
    query: "needle",
    candidates,
    readMessages: reader({
      a: [{ text: "needle", role: "user" }],
      b: [{ text: "needle", role: "user" }],
    }),
    limits: { maxHits: 1 },
  });
  expect(fewHits.hits).toHaveLength(1);
  expect(fewHits.truncated).toBe(true);
});

test("aborts when superseded", async () => {
  const controller = new AbortController();
  const readMessages = vi.fn(async () => {
    controller.abort();
    return [{ text: "needle", role: "user" as const }];
  });
  await expect(
    searchSessionText({
      query: "needle",
      candidates: [candidate("a", "2026-10-01T00:00:00Z")],
      readMessages,
      signal: controller.signal,
    }),
  ).rejects.toThrow();
});

test("treats regex syntax in the query literally", async () => {
  const result = await searchSessionText({
    query: "a.b(c)*",
    candidates: [candidate("a", "2026-10-01T00:00:00Z")],
    readMessages: reader({
      a: [
        { text: "axb(c)", role: "user" },
        { text: "call a.b(c)* here", role: "assistant" },
      ],
    }),
  });
  expect(result.hits.map((hit) => hit.snippet)).toEqual(["call a.b(c)* here"]);
});

test("snippets stay within the length bound, keep the match, and mark cut edges", () => {
  const text = `${"lead ".repeat(60)}the needle sits here${" tail".repeat(60)}`;
  const matchIndex = text.indexOf("needle");
  const snippet = buildSessionTextSnippet({ text, matchIndex, matchLength: 6, maxLength: 160 });
  expect(snippet.snippet.length).toBeLessThanOrEqual(160);
  expect(snippet.snippet.startsWith("…")).toBe(true);
  expect(snippet.snippet.endsWith("…")).toBe(true);
  expect(snippet.snippet.slice(snippet.matchStart, snippet.matchStart + 6)).toBe("needle");

  const atStart = buildSessionTextSnippet({ text, matchIndex: 0, matchLength: 4, maxLength: 160 });
  expect(atStart.snippet.startsWith("…")).toBe(false);
  expect(atStart.matchStart).toBe(0);

  const atEnd = buildSessionTextSnippet({
    text,
    matchIndex: text.length - 4,
    matchLength: 4,
    maxLength: 160,
  });
  expect(atEnd.snippet.endsWith("…")).toBe(false);
  expect(atEnd.snippet.slice(atEnd.matchStart)).toBe("tail");
  expect(atEnd.snippet.length).toBeLessThanOrEqual(160);
});
