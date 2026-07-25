import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { projectNotebookEvents } from "@getpaseo/protocol/notebook/projections";
import {
  WorkNotebookInvalidTargetError,
  WorkNotebookRevisionConflictError,
  WorkNotebookStore,
  type WorkNotebookStoreDependencies,
} from "./store.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function createStore(): Promise<{
  store: WorkNotebookStore;
  directory: string;
  dependencies: WorkNotebookStoreDependencies;
}> {
  const directory = await mkdtemp(join(tmpdir(), "paseo-work-notebook-"));
  directories.push(directory);
  let timestamp = Date.parse("2026-07-25T00:00:00.000Z");
  let id = 0;
  const dependencies: WorkNotebookStoreDependencies = {
    now: () => new Date((timestamp += 1_000)),
    createId: () => `event-${(id += 1)}`,
  };
  return {
    store: new WorkNotebookStore(directory, dependencies),
    directory,
    dependencies,
  };
}

describe("WorkNotebookStore", () => {
  it("creates one stable session notebook lazily and persists its canonical stream", async () => {
    const { store, directory, dependencies } = await createStore();
    const created = await store.ensureSessionNotebook("agent-1");
    const sameNotebook = await store.ensureSessionNotebook("agent-1");

    expect(sameNotebook).toEqual(created);

    const note = await store.append({
      agentId: "agent-1",
      expectedRevision: 0,
      author: { kind: "user" },
      entry: { kind: "note_added", markdown: "Keep the key link visible" },
    });
    const question = await store.append({
      agentId: "agent-1",
      expectedRevision: note.notebook.revision,
      author: { kind: "user" },
      entry: { kind: "question_opened", markdown: "Which layout should ship first?" },
    });

    const reloaded = new WorkNotebookStore(directory, dependencies);
    const page = await reloaded.getSessionNotebookPage({ agentId: "agent-1" });
    expect(page.notebook).toEqual(question.notebook);
    expect(page.events.map((event) => [event.sequence, event.kind])).toEqual([
      [1, "note_added"],
      [2, "question_opened"],
    ]);
    expect(page.hasMore).toBe(false);
  });

  it("resolves and reopens questions by appending state events", async () => {
    const { store } = await createStore();
    const question = await store.append({
      agentId: "agent-1",
      expectedRevision: 0,
      author: { kind: "user" },
      entry: { kind: "question_opened", markdown: "Is the PWA enough for testing?" },
    });
    const resolved = await store.append({
      agentId: "agent-1",
      expectedRevision: question.notebook.revision,
      author: { kind: "user" },
      entry: { kind: "question_resolved", targetEventId: question.event.id },
    });
    const resolvedPage = await store.getSessionNotebookPage({ agentId: "agent-1" });
    expect(projectNotebookEvents(resolvedPage.events).openQuestions).toEqual([]);

    await store.append({
      agentId: "agent-1",
      expectedRevision: resolved.notebook.revision,
      author: { kind: "user" },
      entry: { kind: "question_reopened", targetEventId: question.event.id },
    });
    const reopenedPage = await store.getSessionNotebookPage({ agentId: "agent-1" });
    expect(projectNotebookEvents(reopenedPage.events).openQuestions).toEqual([question.event]);
  });

  it("rejects a stale writer with the current revision", async () => {
    const { store } = await createStore();
    await store.append({
      agentId: "agent-1",
      expectedRevision: 0,
      author: { kind: "user" },
      entry: { kind: "note_added", markdown: "First write" },
    });

    await expect(
      store.append({
        agentId: "agent-1",
        expectedRevision: 0,
        author: { kind: "user" },
        entry: { kind: "note_added", markdown: "Stale write" },
      }),
    ).rejects.toEqual(new WorkNotebookRevisionConflictError(1));
  });

  it("rejects state changes that target an unknown event", async () => {
    const { store } = await createStore();

    await expect(
      store.append({
        agentId: "agent-1",
        expectedRevision: 0,
        author: { kind: "user" },
        entry: { kind: "item_pinned", targetEventId: "missing-event" },
      }),
    ).rejects.toEqual(new WorkNotebookInvalidTargetError("Notebook item not found"));
  });

  it("paginates the canonical stream by sequence without overlap", async () => {
    const { store } = await createStore();
    for (let revision = 0; revision < 5; revision += 1) {
      await store.append({
        agentId: "agent-1",
        expectedRevision: revision,
        author: { kind: "user" },
        entry: { kind: "note_added", markdown: `Note ${revision + 1}` },
      });
    }

    const first = await store.getSessionNotebookPage({ agentId: "agent-1", limit: 2 });
    const second = await store.getSessionNotebookPage({
      agentId: "agent-1",
      afterSequence: 2,
      limit: 2,
    });
    const third = await store.getSessionNotebookPage({
      agentId: "agent-1",
      afterSequence: 4,
      limit: 2,
    });

    expect(first.events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(first.hasMore).toBe(true);
    expect(second.events.map((event) => event.sequence)).toEqual([3, 4]);
    expect(second.hasMore).toBe(true);
    expect(third.events.map((event) => event.sequence)).toEqual([5]);
    expect(third.hasMore).toBe(false);
  });

  it("serializes concurrent appends so only one stale expected revision is applied", async () => {
    const { store } = await createStore();

    const results = await Promise.allSettled([
      store.append({
        agentId: "agent-1",
        expectedRevision: 0,
        author: { kind: "user" },
        entry: { kind: "note_added", markdown: "Writer A" },
      }),
      store.append({
        agentId: "agent-1",
        expectedRevision: 0,
        author: { kind: "user" },
        entry: { kind: "note_added", markdown: "Writer B" },
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.reason).toEqual(new WorkNotebookRevisionConflictError(1));
    const page = await store.getSessionNotebookPage({ agentId: "agent-1" });
    expect(page.events).toHaveLength(1);
    expect(page.notebook.revision).toBe(1);
  });

  it("reconciles links and artifact versions into stable, non-duplicating stream events", async () => {
    const { store, directory, dependencies } = await createStore();
    const sources = {
      links: [
        {
          url: "https://paseo.sh/",
          source: {
            agentId: "agent-1",
            timelineSequence: 4,
            messageId: "message-1",
            role: "assistant" as const,
          },
        },
      ],
      artifacts: [
        {
          path: "reports/status.md",
          name: "status.md",
          kind: "markdown" as const,
          mimeType: "text/markdown",
          size: 42,
          createdAt: "2026-07-25T00:00:00.000Z",
          updatedAt: "2026-07-25T00:00:01.000Z",
        },
      ],
    };

    await store.reconcileDerivedSources({ agentId: "agent-1", sources });
    await store.reconcileDerivedSources({ agentId: "agent-1", sources });

    const reloaded = new WorkNotebookStore(directory, dependencies);
    await reloaded.reconcileDerivedSources({
      agentId: "agent-1",
      sources: {
        ...sources,
        artifacts: [
          {
            ...sources.artifacts[0],
            size: 84,
            updatedAt: "2026-07-25T00:00:02.000Z",
          },
        ],
      },
    });
    const page = await reloaded.getSessionNotebookPage({ agentId: "agent-1" });

    expect(page.events.map((event) => event.kind)).toEqual([
      "link_captured",
      "artifact_observed",
      "artifact_observed",
    ]);
    expect(new Set(page.events.map((event) => event.id)).size).toBe(3);
    expect(page.notebook.revision).toBe(3);
    expect(page.events[0]).toMatchObject({
      kind: "link_captured",
      url: "https://paseo.sh/",
      source: { timelineSequence: 4, role: "assistant" },
    });
  });
});
