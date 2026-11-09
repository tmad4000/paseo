import { describe, expect, it } from "vitest";
import {
  MAX_SNAPSHOT_TASKS,
  MAX_SNAPSHOT_TASK_TEXT,
  sameAgentTaskSnapshot,
  toAgentTaskSnapshot,
} from "./agent-task-snapshot.js";

describe("agent task snapshot", () => {
  it("bounds the number of tasks and the length of their text", () => {
    const items = Array.from({ length: MAX_SNAPSHOT_TASKS + 5 }, (_, index) => ({
      id: String(index),
      text: "x".repeat(MAX_SNAPSHOT_TASK_TEXT + 10),
      completed: false,
      status: "pending" as const,
    }));
    const snapshot = toAgentTaskSnapshot(items);
    expect(snapshot).toHaveLength(MAX_SNAPSHOT_TASKS);
    expect(snapshot[0]?.text).toHaveLength(MAX_SNAPSHOT_TASK_TEXT);
    expect(snapshot[0]?.text.endsWith("…")).toBe(true);
  });

  it("drops absent optional fields rather than writing undefined", () => {
    expect(toAgentTaskSnapshot([{ text: "Plan", completed: false }])).toEqual([
      { text: "Plan", completed: false },
    ]);
  });

  it("compares by content", () => {
    const a = [{ id: "1", text: "Plan", completed: false, status: "in_progress" as const }];
    expect(sameAgentTaskSnapshot(a, [{ ...a[0]! }])).toBe(true);
    expect(sameAgentTaskSnapshot(a, [{ ...a[0]!, status: "completed", completed: true }])).toBe(
      false,
    );
    expect(sameAgentTaskSnapshot(undefined, [])).toBe(true);
  });
});
