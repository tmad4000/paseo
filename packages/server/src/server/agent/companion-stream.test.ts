import { describe, expect, it } from "vitest";
import type { CompanionEntry } from "@getpaseo/protocol/companion-stream";
import {
  CompanionStreamCollector,
  restoreCompanionEntries,
  COMPANION_ENTRY_LIMIT,
  COMPANION_TEXT_LIMIT,
} from "./companion-stream.js";

describe("conversation companion stream", () => {
  it("returns the same entries reference when an event changes nothing", () => {
    const collector = new CompanionStreamCollector();
    const timestamp = "2026-09-21T12:00:00.000Z";
    const settled: CompanionEntry[] = [
      {
        id: "turn:t0:question",
        kind: "question",
        timestamp,
        text: "Ship it?",
        truncated: false,
        status: "reply_sent",
      },
    ];
    // A user message only moves open questions to reply_sent; with none open, the
    // agent manager must not emit a fresh agent state for it.
    const afterUserMessage = collector.observe(
      "agent",
      settled,
      {
        type: "timeline",
        provider: "codex",
        turnId: "t1",
        item: { type: "user_message", id: "u1", messageId: "u1", text: "go", timestamp },
      } as never,
      timestamp,
    );
    expect(afterUserMessage).toBe(settled);
    const afterUnrelatedResolution = collector.observe(
      "agent",
      settled,
      {
        type: "permission_resolved",
        provider: "codex",
        requestId: "not-tracked",
        resolution: { behavior: "allow" },
      } as never,
      timestamp,
    );
    expect(afterUnrelatedResolution).toBe(settled);
  });

  it("keeps a question open until the provider resolves its permission request", () => {
    const collector = new CompanionStreamCollector();
    const timestamp = "2026-09-21T12:00:00.000Z";
    const pending = collector.observe(
      "agent",
      [],
      {
        type: "permission_requested",
        provider: "codex",
        request: {
          id: "q1",
          provider: "codex",
          name: "request_user_input",
          kind: "question",
          input: { questions: [{ question: "Which database should we use?" }] },
        },
      },
      timestamp,
    );
    expect(pending).toEqual([
      {
        id: "permission:q1",
        kind: "permission",
        requestId: "q1",
        requestKind: "question",
        text: "Which database should we use?",
        timestamp,
        status: "pending",
        truncated: false,
      },
    ]);
    expect(
      collector.observe(
        "agent",
        pending,
        {
          type: "permission_resolved",
          provider: "codex",
          requestId: "q1",
          resolution: { behavior: "allow" },
        },
        timestamp,
      ),
    ).toEqual([{ ...pending[0], status: "allowed" }]);
  });
});

const timestamp = "2026-09-21T12:00:00.000Z";

it("collects only the final response, merges chunks, and keeps other agents separate", () => {
  const collector = new CompanionStreamCollector();
  const output = (agentId: string, text: string) =>
    collector.observe(
      agentId,
      [],
      {
        type: "timeline",
        provider: "codex",
        turnId: "run",
        item: { type: "assistant_message", text },
      },
      timestamp,
    );
  expect(output("one", "I will inspect the files")).toEqual([]);
  collector.observe(
    "one",
    [],
    {
      type: "timeline",
      provider: "codex",
      turnId: "run",
      item: {
        type: "tool_call",
        callId: "read",
        name: "read",
        status: "completed",
        error: null,
        detail: { type: "read", filePath: "README.md" },
      },
    },
    timestamp,
  );
  output("one", "Implemented ");
  output("two", "Unrelated result");
  output("one", "the feature.");
  const result = collector.observe(
    "one",
    [],
    { type: "turn_completed", provider: "codex", turnId: "run" },
    timestamp,
  );
  expect(result).toEqual([
    {
      id: "turn:run",
      kind: "outcome",
      timestamp,
      text: "Implemented the feature.",
      truncated: false,
      status: "completed",
    },
  ]);
  expect(
    collector.observe(
      "one",
      result,
      { type: "turn_completed", provider: "codex", turnId: "run" },
      timestamp,
    ),
  ).toEqual(result);
});

it("tracks prose questions without claiming a reply resolved a decision", () => {
  const collector = new CompanionStreamCollector();
  collector.observe(
    "a",
    [],
    {
      type: "timeline",
      provider: "codex",
      turnId: "q",
      item: { type: "assistant_message", text: "Use SQLite or Postgres?" },
    },
    timestamp,
  );
  const result = collector.observe(
    "a",
    [],
    { type: "turn_completed", provider: "codex", turnId: "q" },
    timestamp,
  );
  expect(result).toEqual([
    {
      id: "turn:q:question",
      kind: "question",
      timestamp,
      text: "Use SQLite or Postgres?",
      truncated: false,
      status: "open",
    },
    { id: "turn:q", kind: "outcome", timestamp, text: "", truncated: false, status: "completed" },
  ]);
  expect(
    collector.observe(
      "a",
      result,
      {
        type: "timeline",
        provider: "codex",
        item: { type: "user_message", text: "What do you recommend?" },
      },
      timestamp,
    ),
  ).toEqual(result);
});

it.each([
  "Example: `ready?`",
  "Example:\n```js\nready?\n```",
  "See https://example.com/?",
  "`ready?`",
  "https://example.com/?",
  "Open questions:\n- `ready?`\n- https://example.com/?\n```text\n- Use production?\n```",
])("does not turn code or URLs into open questions: %s", (text) => {
  const collector = new CompanionStreamCollector();
  collector.observe(
    "a",
    [],
    {
      type: "timeline",
      provider: "codex",
      turnId: "r",
      item: { type: "assistant_message", text },
    },
    timestamp,
  );
  expect(
    collector
      .observe("a", [], { type: "turn_completed", provider: "codex", turnId: "r" }, timestamp)
      .map((entry) => entry.kind),
  ).toEqual(["outcome"]);
});

it.each([
  {
    text: "Use `staging`?\nUse `production`?\nUse `staging`?",
    questions: ["Use `staging`?", "Use `production`?"],
  },
  {
    text: "- Should we use https://staging.example.com/?preview=1 for preview?\n- Should we use https://production.example.com/?preview=1 for preview?",
    questions: [
      "Should we use https://staging.example.com/?preview=1 for preview?",
      "Should we use https://production.example.com/?preview=1 for preview?",
    ],
  },
  {
    text: "**Still need your input:**\n1. Choose `staging` or `production`\n2. Confirm https://example.com/?preview=1 as the preview URL",
    questions: [
      "Choose `staging` or `production`",
      "Confirm https://example.com/?preview=1 as the preview URL",
    ],
  },
])("preserves original prose in separately captured questions: $text", ({ text, questions }) => {
  const collector = new CompanionStreamCollector();
  collector.observe(
    "a",
    [],
    {
      type: "timeline",
      provider: "codex",
      turnId: "preserved",
      item: { type: "assistant_message", text },
    },
    timestamp,
  );
  const entries = collector.observe(
    "a",
    [],
    { type: "turn_completed", provider: "codex", turnId: "preserved" },
    timestamp,
  );
  expect(entries.filter((entry) => entry.kind === "question")).toEqual(
    questions.map((question, index) => ({
      id: `turn:preserved:question${index ? `:${index}` : ""}`,
      kind: "question",
      timestamp,
      text: question,
      truncated: false,
      status: "open",
    })),
  );
});

it("retains structured questions after unrelated user messages and expires them on interruption", () => {
  const collector = new CompanionStreamCollector();
  const entries = collector.observe(
    "a",
    [],
    {
      type: "permission_requested",
      provider: "codex",
      request: {
        id: "p",
        name: "approval",
        kind: "plan",
        provider: "codex",
        detail: { type: "plan", text: "Migrate the database" },
      },
    },
    timestamp,
  );
  expect(
    collector.observe(
      "a",
      entries,
      { type: "timeline", provider: "codex", item: { type: "user_message", text: "Wait" } },
      timestamp,
    ),
  ).toEqual(entries);
  expect(
    collector.observe(
      "a",
      entries,
      { type: "turn_canceled", provider: "codex", turnId: "r", reason: "Stopped by user" },
      timestamp,
    ),
  ).toEqual([
    { ...entries[0], status: "expired" },
    {
      id: "turn:r",
      kind: "outcome",
      timestamp,
      text: "Stopped by user",
      truncated: false,
      status: "canceled",
    },
  ]);
  expect(restoreCompanionEntries({ companionEntries: entries })).toEqual([
    { ...entries[0], status: "expired" },
  ]);
});

it("bounds stored output and records failure independently of an assistant success claim", () => {
  const collector = new CompanionStreamCollector();
  collector.observe(
    "a",
    [],
    {
      type: "timeline",
      provider: "codex",
      turnId: "r",
      item: { type: "assistant_message", text: "Succeeded!" },
    },
    timestamp,
  );
  const error = "x".repeat(COMPANION_TEXT_LIMIT + 100);
  expect(
    collector.observe(
      "a",
      [],
      { type: "turn_failed", provider: "codex", turnId: "r", error },
      timestamp,
    ),
  ).toEqual([
    {
      id: "turn:r",
      kind: "outcome",
      timestamp,
      text: error.slice(0, COMPANION_TEXT_LIMIT),
      truncated: true,
      status: "failed",
    },
  ]);
  let entries: CompanionEntry[] = [];
  for (let i = 0; i < COMPANION_ENTRY_LIMIT + 2; i++) {
    entries = collector.observe(
      "a",
      entries,
      { type: "turn_completed", provider: "codex", turnId: String(i) },
      timestamp,
    );
  }
  expect(entries.map((entry) => entry.id)).toEqual(
    Array.from({ length: COMPANION_ENTRY_LIMIT }, (_, i) => `turn:${i + 2}`),
  );
});

it("retains pins and each unanswered question beyond the recent outcome window", () => {
  const collector = new CompanionStreamCollector();
  let entries: CompanionEntry[] = [
    { id: "q1", kind: "question", status: "open", text: "First?", timestamp, truncated: false },
    {
      id: "q2",
      kind: "question",
      status: "reviewed",
      text: "Second?",
      timestamp,
      truncated: false,
    },
    { id: "pin", kind: "pin", text: "Keep this", timestamp, truncated: false },
    {
      id: "permission",
      kind: "permission",
      requestId: "p",
      requestKind: "question",
      status: "pending",
      text: "Choose",
      timestamp,
      truncated: false,
    },
  ];
  for (let i = 0; i < 60; i++) {
    entries = collector.observe(
      "a",
      entries,
      { type: "turn_completed", provider: "codex", turnId: String(i) },
      timestamp,
    );
  }
  expect(entries.slice(0, 4).map((entry) => entry.id)).toEqual(["q1", "q2", "pin", "permission"]);
  expect(entries.filter((entry) => entry.kind === "outcome")).toHaveLength(50);
});

it("captures each explicitly labelled needed input even without a final question mark", () => {
  const collector = new CompanionStreamCollector();
  collector.observe(
    "a",
    [],
    {
      type: "timeline",
      provider: "codex",
      turnId: "list",
      item: {
        type: "assistant_message",
        text: "Progress is saved.\n\n**Still need your input:**\n1. Choose the name\n2. Pick a release channel\n\n## Completed\n- Tests passed",
      },
    },
    timestamp,
  );
  const entries = collector.observe(
    "a",
    [],
    { type: "turn_completed", provider: "codex", turnId: "list" },
    timestamp,
  );
  expect(entries.filter((entry) => entry.kind === "question").map((entry) => entry.text)).toEqual([
    "Choose the name",
    "Pick a release channel",
  ]);
  expect(entries.at(-1)?.kind).toBe("outcome");
});

import { listStreamRows } from "./global-stream.js";

it("pages global items without collisions, includes dormant records and excludes hidden/archived agents", () => {
  const entry: CompanionEntry = {
    id: "same",
    kind: "question",
    status: "open",
    text: "Pick a name?",
    timestamp,
    truncated: false,
  };
  const sources = [
    { id: "a", cwd: "/project/a", companionEntries: [entry] },
    { id: "b", cwd: "/project/b", companionEntries: [entry] },
    { id: "hidden", cwd: "/project", internal: true, companionEntries: [entry] },
    { id: "archived", cwd: "/project", archivedAt: timestamp, companionEntries: [entry] },
  ];
  const first = listStreamRows(sources, { limit: 1 });
  const second = listStreamRows(sources, { limit: 1, cursor: first.nextCursor! });
  expect(first.rows.map((row) => row.agentId)).toEqual(["a"]);
  expect(second.rows.map((row) => row.agentId)).toEqual(["b"]);
  expect(second.nextCursor).toBeNull();
  expect(listStreamRows(sources, { includeArchived: true }).rows.map((row) => row.agentId)).toEqual(
    ["a", "archived", "b"],
  );
  expect(
    listStreamRows(sources, { search: "/project/b", filter: "pending" }).rows.map(
      (row) => row.agentId,
    ),
  ).toEqual(["b"]);
  expect(listStreamRows(sources, { filter: "pinned" }).rows).toEqual([]);
  expect(() => listStreamRows(sources, { cursor: "bad" })).toThrow();
});

import { applyStreamEntryUpdate } from "./stream-entry-update.js";
it("retries a pin save without duplicating the live entry after a failed acknowledgement", () => {
  const input = {
    agentId: "a",
    action: "add_pin" as const,
    entryId: "draft",
    text: "Keep context",
  };
  const first = applyStreamEntryUpdate([], input);
  expect(applyStreamEntryUpdate(first, input)).toEqual(first);
});

it("upserts durable questions by identity and resolves only the selected item", () => {
  const base = { agentId: "a", action: "add_question" as const };
  let entries = applyStreamEntryUpdate([], { ...base, entryId: "name", text: "Choose name" });
  entries = applyStreamEntryUpdate(entries, {
    ...base,
    entryId: "channel",
    text: "Choose channel",
  });
  entries = applyStreamEntryUpdate(entries, {
    ...base,
    entryId: "name",
    text: "Name selected",
    status: "done",
  });
  expect(
    entries.map((entry) => ({
      id: entry.id,
      text: entry.text,
      status: "status" in entry ? entry.status : null,
    })),
  ).toEqual([
    { id: "question:name", text: "Name selected", status: "done" },
    { id: "question:channel", text: "Choose channel", status: "open" },
  ]);
  expect(
    listStreamRows([{ id: "a", cwd: "/project", companionEntries: entries }], {
      filter: "pending",
    }).rows.map((row) => row.item),
  ).toEqual([{ kind: "entry", entry: entries[1] }]);
  expect(() =>
    applyStreamEntryUpdate(entries, {
      agentId: "a",
      action: "update_status",
      entryId: "missing",
      status: "done",
    }),
  ).toThrow("no longer exists");
  expect(() => applyStreamEntryUpdate(entries, { ...base, text: " " })).toThrow("Enter between");
});

it("keeps needed input on provider recreation without reviving tool permissions", () => {
  const base = {
    id: "p",
    kind: "permission" as const,
    requestId: "q",
    status: "pending" as const,
    text: "Which channel?",
    timestamp,
    truncated: false,
  };
  expect(
    restoreCompanionEntries({
      companionEntries: [
        { ...base, requestKind: "question" },
        { ...base, id: "tool", requestKind: "tool" },
      ],
    }),
  ).toEqual([
    {
      id: "p",
      kind: "question",
      status: "open",
      text: "Which channel?",
      timestamp,
      truncated: false,
    },
    { ...base, id: "tool", requestKind: "tool", status: "expired" },
  ]);
});

it.each(["interruption", "recreation"])(
  "keeps structured questions independently resolvable after %s",
  (expiry) => {
    const collector = new CompanionStreamCollector();
    const pending = collector.observe(
      "a",
      [],
      {
        type: "permission_requested",
        provider: "codex",
        request: {
          id: "multi",
          provider: "codex",
          name: "request_user_input",
          kind: "question",
          input: {
            questions: [
              { id: "name", question: "Choose name" },
              { id: "channel", question: "Choose channel" },
            ],
          },
        },
      },
      timestamp,
    );
    expect(pending.map((entry) => entry.id)).toEqual([
      "permission:multi",
      "permission:multi:question:1",
    ]);
    expect(
      pending.every((entry) => entry.kind === "permission" && entry.requestId === "multi"),
    ).toBe(true);
    const expired =
      expiry === "recreation"
        ? restoreCompanionEntries({ companionEntries: pending })
        : collector.observe(
            "a",
            pending,
            {
              type: "permission_resolved",
              provider: "codex",
              requestId: "multi",
              resolution: { behavior: "deny", message: "Interrupted" },
              disposition: "expired",
            },
            timestamp,
          );
    const resolved = applyStreamEntryUpdate(expired, {
      agentId: "a",
      action: "update_status",
      entryId: pending[0].id,
      status: "done",
    });
    expect(resolved).toEqual([
      expect.objectContaining({ kind: "question", text: "Choose name", status: "done" }),
      expect.objectContaining({ kind: "question", text: "Choose channel", status: "open" }),
    ]);
    expect(
      listStreamRows([{ id: "a", cwd: "/project", companionEntries: resolved }], {
        filter: "pending",
      }).rows,
    ).toHaveLength(1);
    const denied = collector.observe(
      "a",
      pending,
      {
        type: "permission_resolved",
        provider: "codex",
        requestId: "multi",
        resolution: { behavior: "deny" },
      },
      timestamp,
    );
    expect(
      restoreCompanionEntries({ companionEntries: denied }).every(
        (entry) => entry.kind === "permission" && entry.status === "denied",
      ),
    ).toBe(true);
  },
);

it("expires canceled approvals without reviving them as questions", () => {
  const collector = new CompanionStreamCollector();
  const pending = collector.observe(
    "a",
    [],
    {
      type: "permission_requested",
      provider: "codex",
      request: { id: "tool", provider: "codex", name: "shell", kind: "tool" },
    },
    timestamp,
  );
  expect(
    collector.observe(
      "a",
      pending,
      {
        type: "permission_resolved",
        provider: "codex",
        requestId: "tool",
        disposition: "expired",
        resolution: { behavior: "deny" },
      },
      timestamp,
    ),
  ).toEqual([{ ...pending[0], status: "expired" }]);
});
