import { describe, expect, it } from "vitest";
import { projectNotebookEvents } from "./projections.js";
import type { NotebookEvent, NotebookEventAuthor } from "./types.js";

const author: NotebookEventAuthor = { kind: "user" };

function question(id: string, sequence: number): NotebookEvent {
  return {
    id,
    notebookId: "notebook-1",
    sequence,
    createdAt: `2026-07-25T00:00:0${sequence}.000Z`,
    author,
    kind: "question_opened",
    markdown: `Question ${sequence}?`,
  };
}

function action(
  kind: "question_resolved" | "question_reopened" | "item_pinned" | "item_unpinned",
  targetEventId: string,
  sequence: number,
): NotebookEvent {
  return {
    id: `${kind}-${sequence}`,
    notebookId: "notebook-1",
    sequence,
    createdAt: `2026-07-25T00:00:0${sequence}.000Z`,
    author,
    kind,
    targetEventId,
  };
}

describe("projectNotebookEvents", () => {
  it("keeps a question in the open lens until it is resolved and supports reopening", () => {
    const questionEvent = question("question-1", 1);
    const resolved = action("question_resolved", questionEvent.id, 2);
    const reopened = action("question_reopened", questionEvent.id, 3);

    expect(projectNotebookEvents([questionEvent]).openQuestions).toEqual([questionEvent]);
    expect(projectNotebookEvents([questionEvent, resolved]).openQuestions).toEqual([]);
    expect(projectNotebookEvents([questionEvent, resolved, reopened]).openQuestions).toEqual([
      questionEvent,
    ]);
  });

  it("derives pins without removing the item from the canonical stream", () => {
    const questionEvent = question("question-1", 1);
    const pinned = action("item_pinned", questionEvent.id, 2);
    const unpinned = action("item_unpinned", questionEvent.id, 3);

    expect(projectNotebookEvents([questionEvent, pinned]).pinnedItems).toEqual([questionEvent]);
    expect(projectNotebookEvents([questionEvent, pinned, unpinned]).pinnedItems).toEqual([]);
  });
});
