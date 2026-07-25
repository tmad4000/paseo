import type { NotebookEvent } from "./types.js";

export interface NotebookProjections {
  openQuestions: Extract<NotebookEvent, { kind: "question_opened" }>[];
  pinnedItems: NotebookEvent[];
}

export function projectNotebookEvents(events: readonly NotebookEvent[]): NotebookProjections {
  const eventById = new Map<string, NotebookEvent>();
  const questionState = new Map<string, "open" | "resolved">();
  const pinState = new Map<string, boolean>();

  for (const event of events) {
    eventById.set(event.id, event);
    switch (event.kind) {
      case "question_opened":
        questionState.set(event.id, "open");
        break;
      case "question_resolved":
        questionState.set(event.targetEventId, "resolved");
        break;
      case "question_reopened":
        questionState.set(event.targetEventId, "open");
        break;
      case "item_pinned":
        pinState.set(event.targetEventId, true);
        break;
      case "item_unpinned":
        pinState.set(event.targetEventId, false);
        break;
      default:
        break;
    }
  }

  const openQuestions: Extract<NotebookEvent, { kind: "question_opened" }>[] = [];
  const pinnedItems: NotebookEvent[] = [];
  for (const event of events) {
    if (event.kind === "question_opened" && questionState.get(event.id) === "open") {
      openQuestions.push(event);
    }
    if (pinState.get(event.id) === true && eventById.has(event.id)) {
      pinnedItems.push(event);
    }
  }

  return { openQuestions, pinnedItems };
}
