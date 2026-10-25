import { expect, test, vi } from "vitest";
import { SessionSearchResultSchema } from "@getpaseo/protocol/messages";
import {
  searchExistingSessions,
  selectSessionSearchExcerpts,
  type SessionSearchExcerpt,
  type SessionSearchCandidate,
  type SessionSearchRanking,
} from "./session-search.js";
const candidate: SessionSearchCandidate = {
  agentId: "chat",
  workspaceId: "workspace",
  projectId: "project",
  projectName: "Paseo",
  title: "Offline indicator",
  cwd: "/fixture",
  updatedAt: "2026-10-01",
  excerpts: [{ text: "Offline indicator", source: "title" }],
};
function fixture(matches: SessionSearchRanking["matches"]) {
  return {
    query: "Where were we working on the offline indicator?",
    workspaceIds: ["workspace"],
    candidates: [candidate],
    readContext: vi.fn(
      async (): Promise<SessionSearchExcerpt[]> => [
        {
          text: "Relay reconnect investigation",
          source: "user_message",
          timestamp: "2026-10-01T12:30:00Z",
        },
      ],
    ),
    generate: vi.fn(async () => ({ matches })),
  };
}
test("returns only existing scoped IDs and verbatim evidence", async () => {
  const input = fixture([{ agentId: "chat", confidence: 0.95, excerptIndex: 1 }]);
  input.candidates.push({ ...candidate, agentId: "outside", workspaceId: "other" });
  expect((await searchExistingSessions(input)).results).toEqual([
    {
      agentId: "chat",
      workspaceId: "workspace",
      projectId: "project",
      projectName: "Paseo",
      title: "Offline indicator",
      excerpt: "Relay reconnect investigation",
      confidence: 0.95,
      excerptTimestamp: "2026-10-01T12:30:00Z",
      excerptSource: "user_message",
      updatedAt: "2026-10-01",
    },
  ]);
  expect(input.readContext).toHaveBeenCalledTimes(1);
});
test("rejects fabricated destinations or evidence", async () => {
  await expect(
    searchExistingSessions(fixture([{ agentId: "invented", confidence: 1, excerptIndex: 0 }])),
  ).rejects.toThrow("invalid conversation");
  await expect(
    searchExistingSessions(fixture([{ agentId: "chat", confidence: 1, excerptIndex: 9 }])),
  ).rejects.toThrow("invalid evidence");
});
test("no matching session is an empty result and empty scope does not generate", async () => {
  expect((await searchExistingSessions(fixture([]))).results).toEqual([]);
  const input = fixture([]);
  input.workspaceIds = [];
  expect(await searchExistingSessions(input)).toEqual({
    results: [],
    searchedCount: 0,
    totalCount: 0,
  });
  expect(input.generate).not.toHaveBeenCalled();
  expect(input.readContext).not.toHaveBeenCalled();
});
test("shortlists before timeline reads and exposes incomplete coverage", async () => {
  const input = fixture([]);
  input.candidates = Array.from({ length: 150 }, (_, i) => ({
    ...candidate,
    agentId: `chat-${i}`,
  }));
  expect(await searchExistingSessions(input)).toMatchObject({
    searchedCount: 100,
    totalCount: 150,
  });
  expect(input.readContext).toHaveBeenCalledTimes(100);
});

test("queued-only topics participate in shortlisting with original evidence and time", async () => {
  const input = fixture([{ agentId: "queued", confidence: 0.8, excerptIndex: 1 }]);
  input.query = "Where were we discussing recording on Notestream Vision?";
  input.candidates = Array.from({ length: 110 }, (_, index) => ({
    ...candidate,
    agentId: `recent-${index}`,
  }));
  input.candidates.push({
    ...candidate,
    agentId: "queued",
    updatedAt: "2026-09-01",
    excerpts: [
      { text: "Unrelated title", source: "title" },
      ...selectSessionSearchExcerpts(
        [
          {
            text:
              "We were checking setup " +
              "x".repeat(1000) +
              " Start recording on Notestream Vision",
            source: "queued_message",
            timestamp: "2026-10-01T14:22:00Z",
          },
        ],
        input.query,
      ),
    ],
  });
  const result = await searchExistingSessions(input);
  expect(result.results[0]).toMatchObject({
    agentId: "queued",
    excerptSource: "queued_message",
    excerptTimestamp: "2026-10-01T14:22:00Z",
  });
  expect(result.results[0].excerpt).toContain("Start recording on Notestream Vision");
  expect(result.results[0].excerpt.length).toBeLessThanOrEqual(800);
  expect(input.readContext).toHaveBeenCalledWith("queued");
});

test.each(["user_message", "queued_message"] as const)(
  "selects the strongest verbatim window for a long %s with common query terms first",
  (source) => {
    const text =
      "We were checking setup recording " +
      "x".repeat(1000) +
      " Start recording on Notestream Vision " +
      "y".repeat(1000);
    const timestamp = "2026-10-01T14:22:00Z";
    const [selected] = selectSessionSearchExcerpts(
      [{ text, source, timestamp }],
      "Where were we discussing recording on Notestream Vision?",
    );
    expect(selected).toMatchObject({ source, timestamp });
    expect(selected.text).toContain("Start recording on Notestream Vision");
    expect(selected.text).toHaveLength(800);
    expect(text.includes(selected.text)).toBe(true);
  },
);

test("distinct query coverage outweighs repeated terms and preserves widely spaced hits", () => {
  const text =
    "recording ".repeat(100) + "x".repeat(1000) + "Notestream" + "y".repeat(760) + " Vision";
  const [selected] = selectSessionSearchExcerpts(
    [{ text, source: "user_message" }],
    "recording recording recording Notestream Vision",
  );
  expect(selected.text).toContain("Notestream");
  expect(selected.text).toContain("Vision");
  expect(selected.text).toHaveLength(800);
  expect(text.includes(selected.text)).toBe(true);
});

test("queued evidence never escapes workspace scope", async () => {
  const input = fixture([]);
  input.candidates.push({
    ...candidate,
    agentId: "outside",
    workspaceId: "outside",
    excerpts: [{ text: "recording", source: "queued_message" }],
  });
  await searchExistingSessions(input);
  expect(input.readContext).not.toHaveBeenCalledWith("outside");
  expect(input.generate.mock.calls[0]).not.toBeUndefined();
});

test("keeps older matching prompts and finds hits beyond the old 800-character prefix", () => {
  const excerpts: SessionSearchExcerpt[] = [
    {
      text: "x".repeat(1000) + " start recording on Vision",
      source: "user_message",
      timestamp: "2026-10-01T12:30:00Z",
    },
    ...Array.from(
      { length: 20 },
      (_, index): SessionSearchExcerpt => ({
        text: `Unrelated progress ${index}`,
        source: "assistant_message",
      }),
    ),
  ];
  const selected = selectSessionSearchExcerpts(excerpts, "recording");
  expect(selected).toHaveLength(7);
  expect(selected[0]).toMatchObject({ source: "user_message", timestamp: "2026-10-01T12:30:00Z" });
  expect(selected[0].text).toContain("start recording on Vision");
  expect(selected.at(-1)?.text).toBe("Unrelated progress 19");
  expect(selected.every(({ text }) => text.length <= 800)).toBe(true);
});

test("result schema accepts old hosts without timestamp metadata", () => {
  const legacy = {
    agentId: "chat",
    workspaceId: "workspace",
    projectId: "project",
    projectName: "Paseo",
    title: "Recording",
    excerpt: "Start recording",
    confidence: 0.9,
  };
  expect(SessionSearchResultSchema.parse(legacy)).toEqual(legacy);
  expect(
    SessionSearchResultSchema.parse({
      ...legacy,
      excerptSource: "queued_message",
      excerptTimestamp: "2026-10-05T12:30:00Z",
      updatedAt: "2026-10-05T12:30:00Z",
    }),
  ).toMatchObject({ excerptSource: "queued_message" });
});
test("a pasted session id answers without the ranking model, within scope", async () => {
  const id = "9b8394eb-de93-4c1a-8f3e-0123456789ab";
  const input = fixture([]);
  input.query = " 9b8394eb ";
  input.candidates = [
    { ...candidate, agentId: id, title: "Release orchestrator" },
    { ...candidate, agentId: "9b8394eb-0000-4000-8000-000000000000", workspaceId: "other" },
    { ...candidate, agentId: "aaaaaaaa-1111-4111-8111-111111111111" },
  ];
  const result = await searchExistingSessions(input);
  expect(result.results.map((entry) => entry.agentId)).toEqual([id]);
  expect(result.results[0]).toMatchObject({ confidence: 1, title: "Release orchestrator" });
  expect(SessionSearchResultSchema.safeParse(result.results[0]).success).toBe(true);
  expect(input.generate).not.toHaveBeenCalled();
  expect(input.readContext).not.toHaveBeenCalled();
});
test("an id-shaped query that names nothing falls through to ranking", async () => {
  const input = fixture([]);
  input.query = "12345678";
  await searchExistingSessions(input);
  expect(input.generate).toHaveBeenCalledTimes(1);
});
