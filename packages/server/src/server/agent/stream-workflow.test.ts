import { describe, expect, it } from "vitest";
import {
  getAnswerAttention,
  needsUserInput,
  type CompanionEntry,
} from "@getpaseo/protocol/companion-stream";
import { applyStreamEntryUpdate, assertStreamWriteAuthority } from "./stream-entry-update.js";
import { listStreamRows } from "./global-stream.js";
import { restoreCompanionEntries } from "./companion-stream.js";

const origin = { serverId: "host-a", agentId: "origin", entryId: "ask:ship" };
const create = {
  agentId: "origin",
  entryId: "ship",
  action: "set_ask" as const,
  expectedRevision: 0,
  text: "Ship this",
  ask: {
    state: "in_progress" as const,
    remaining: "Implement and review",
    evidence: "",
    sessions: [{ serverId: "host-b", agentId: "worker" }],
  },
};
const source = (entries: CompanionEntry[]) => [
  { id: "origin", cwd: "/p", archivedAt: "2026-10-01", companionEntries: entries },
];

describe("shared task workflow", () => {
  it("keeps one task across archived origin and a worker on another host", () => {
    const entries = applyStreamEntryUpdate([], create);
    const global = listStreamRows(source(entries), { view: "tasks" }, "host-a");
    const local = listStreamRows(
      source(entries),
      { view: "tasks", relatedAgentId: "worker", relatedServerId: "host-b" },
      "host-a",
    );
    expect(global.rows).toHaveLength(1);
    expect(local.rows).toEqual(global.rows);
    expect(
      listStreamRows(
        source(entries),
        { view: "tasks", relatedAgentId: "worker", relatedServerId: "other-host" },
        "host-a",
      ).rows,
    ).toEqual([]);
    const revised = applyStreamEntryUpdate(entries, {
      ...create,
      expectedRevision: 1,
      text: "Ship the reviewed change",
      ask: { ...create.ask, sessions: undefined },
    });
    expect(revised[0].ask?.taskId).toEqual(entries[0].ask?.taskId);
    expect(revised[0].ask?.sessions).toEqual(create.ask.sessions);
    expect(
      applyStreamEntryUpdate(revised, {
        ...create,
        expectedRevision: 1,
        text: "Ship the reviewed change",
        ask: { ...create.ask, sessions: undefined },
      }),
    ).toBe(revised);
  });

  it("records separate input dependencies while the task runs, never clears them by reading or an unrelated reply", () => {
    let entries = applyStreamEntryUpdate([], create);
    for (const id of ["color", "approval"])
      entries = applyStreamEntryUpdate(entries, {
        agentId: "origin",
        action: "add_question",
        entryId: id,
        text: id,
        inputRequest: {
          kind: "decision",
          recipient: "user",
          task: origin,
          sourceMessageId: `msg-${id}`,
        },
      });
    entries = applyStreamEntryUpdate(entries, {
      agentId: "origin",
      action: "update_status",
      entryId: "question:color",
      status: "reviewed",
    });
    expect(listStreamRows(source(entries), { view: "needs_you" }, "host-a").rows).toHaveLength(2);
    expect(entries[0].ask?.state).toBe("in_progress");
    const done = applyStreamEntryUpdate(entries, {
      agentId: "origin",
      action: "add_question",
      entryId: "color",
      text: "color",
      status: "done",
    });
    expect(done.find((e) => e.id === "question:color")?.inputRequest?.task).toEqual(origin);
    expect(
      listStreamRows(source(done), { view: "needs_you" }, "host-a").rows.map(
        (r) => r.item.kind === "entry" && r.item.entry.id,
      ),
    ).toEqual(["question:approval"]);
  });

  it("separates questions and unseen answers from obligations, and excludes inferred prose", () => {
    let entries = applyStreamEntryUpdate([], {
      ...create,
      ask: { ...create.ask, expectsAnswer: true },
    });
    entries = applyStreamEntryUpdate(entries, {
      agentId: "origin",
      action: "set_reply",
      entryId: "ask:ship",
      text: "Here is the result",
      replyRevision: 0,
    });
    entries.push({
      id: "outcome:turn:question",
      kind: "question",
      status: "open",
      timestamp: "2026-10-27",
      text: "Would you like more?",
      truncated: false,
    });
    expect(entries.map(needsUserInput)).toEqual([false, false]);
    expect(getAnswerAttention(entries[0])).toBe("new_answer");
    expect(listStreamRows(source(entries), { view: "questions" }, "host-a").rows).toHaveLength(1);
    expect(listStreamRows(source(entries), { view: "needs_you" }, "host-a").rows).toEqual([]);
    const seen = applyStreamEntryUpdate(entries, {
      agentId: "origin",
      action: "mark_reply_seen",
      entryId: "ask:ship",
      replyRevision: 1,
    });
    expect(getAnswerAttention(seen[0])).toBeNull();
    expect(seen[0].ask?.state).toBe("in_progress");
  });

  it("retains explicit mirrored history without duplicating canonical work or accepting writes on the mirror", () => {
    const entries = applyStreamEntryUpdate([], create);
    const mirror = applyStreamEntryUpdate([], {
      ...create,
      agentId: "worker",
      ask: { ...create.ask, canonicalTask: origin },
    });
    const sources = [...source(entries), { id: "worker", cwd: "/p", companionEntries: mirror }];
    expect(listStreamRows(sources, { view: "tasks" }, "host-a").rows).toHaveLength(1);
    expect(listStreamRows(sources, { view: "activity" }, "host-a").rows).toHaveLength(2);
    expect(() =>
      applyStreamEntryUpdate(mirror, {
        agentId: "worker",
        action: "update_status",
        entryId: "ask:ship",
        status: "reviewed",
      }),
    ).toThrow("canonical origin");
    expect(() =>
      applyStreamEntryUpdate(mirror, {
        ...create,
        expectedRevision: 1,
        text: "Overwrite canonical through mirror",
      }),
    ).toThrow("canonical origin");
  });

  it("keeps provider permission authority and expires dormant approvals", () => {
    const permission: CompanionEntry = {
      id: "permission:p",
      kind: "permission",
      requestId: "p",
      requestKind: "tool",
      status: "pending",
      timestamp: "2026-10-27",
      text: "Approve deployment",
      truncated: false,
    };
    expect(needsUserInput(permission)).toBe(true);
    expect(() =>
      applyStreamEntryUpdate([permission], {
        agentId: "origin",
        action: "update_status",
        entryId: permission.id,
        status: "done",
      }),
    ).toThrow("cannot be changed");
    expect(restoreCompanionEntries({ companionEntries: [permission] }).map(needsUserInput)).toEqual(
      [false],
    );
  });
});

it("keeps a migrated or copied task visible with its original authority, and refuses local writes", () => {
  const entries = applyStreamEntryUpdate([], create, "host-a");
  expect(entries[0].ask?.origin).toEqual(origin);
  expect(() =>
    assertStreamWriteAuthority(entries, { ...create, expectedRevision: 1 }, "host-b"),
  ).toThrow("canonical origin");
  const migrated = listStreamRows(source(entries), { view: "tasks" }, "host-b").rows;
  expect(migrated).toHaveLength(1);
  expect(migrated[0].item.kind === "entry" && migrated[0].item.entry.ask?.origin).toEqual(origin);
  expect(listStreamRows(source(entries), { view: "activity" }, "host-b").rows).toHaveLength(1);
});

it("requires an exact named external recipient and a parent task for subtask inputs", () => {
  const input = {
    agentId: "origin",
    action: "add_question" as const,
    entryId: "external",
    text: "Get a decision",
  };
  expect(() =>
    applyStreamEntryUpdate([], {
      ...input,
      inputRequest: { kind: "decision", recipient: "external" },
    }),
  ).toThrow("Name the agent or external recipient");
  const entries = applyStreamEntryUpdate([], {
    ...input,
    inputRequest: { kind: "decision", recipient: "external", recipientId: "reviewer-alex" },
  });
  expect(entries.map(needsUserInput)).toEqual([false]);
  expect(() =>
    applyStreamEntryUpdate([], {
      ...input,
      inputRequest: { kind: "decision", recipient: "user", subtaskId: "orphan" },
    }),
  ).toThrow("canonical task reference");
});

it("pages current tasks before completed history without losing either", () => {
  let entries = applyStreamEntryUpdate([], create, "host-a");
  entries = applyStreamEntryUpdate(
    entries,
    {
      ...create,
      entryId: "done",
      text: "Shipped",
      ask: { state: "done", evidence: "Verified", remaining: "" },
    },
    "host-a",
  );
  const first = listStreamRows(source(entries), { view: "tasks", limit: 1 }, "host-a");
  const second = listStreamRows(
    source(entries),
    { view: "tasks", limit: 1, cursor: first.nextCursor! },
    "host-a",
  );
  expect(first.rows.map((r) => r.item.kind === "entry" && r.item.entry.id)).toEqual(["ask:ship"]);
  expect(second.rows.map((r) => r.item.kind === "entry" && r.item.entry.id)).toEqual(["ask:done"]);
  expect(second.nextCursor).toBeNull();
});

it("keeps a legacy task's projected global identity through its first and later edits", () => {
  const entries = applyStreamEntryUpdate([], create, "host-a");
  delete entries[0].ask!.taskId;
  delete entries[0].ask!.origin;
  const projected = listStreamRows(source(entries), { view: "tasks" }, "host-a").rows[0];
  const edited = applyStreamEntryUpdate(
    entries,
    { ...create, expectedRevision: 1, text: "Updated legacy task" },
    "host-a",
  );
  expect(edited[0].ask?.taskId).toBe(projected.taskId);
  expect(edited[0].ask?.origin).toEqual(origin);
  const revised = applyStreamEntryUpdate(
    edited,
    { ...create, expectedRevision: 2, text: "Revised legacy task" },
    "host-a",
  );
  expect(listStreamRows(source(revised), { view: "tasks" }, "host-a").rows[0].taskId).toBe(
    projected.taskId,
  );
});
