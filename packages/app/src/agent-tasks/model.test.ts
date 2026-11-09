import { describe, expect, it } from "vitest";
import type { TodoEntry } from "@/types/stream";
import {
  createWorkspaceTaskProgressSelector,
  resolveSessionTasks,
  sameTaskProgress,
  summarizeOpenTasks,
  type TaskProgressAgent,
} from "./model";

const done = (text: string): TodoEntry => ({ text, completed: true, status: "completed" });
const doing = (text: string, activeForm?: string): TodoEntry => ({
  text,
  completed: false,
  status: "in_progress",
  ...(activeForm ? { activeForm } : {}),
});
const todo = (text: string): TodoEntry => ({ text, completed: false, status: "pending" });

function agent(
  id: string,
  workspaceId: string | undefined,
  tasks: TodoEntry[] | undefined,
  updatedAt = 0,
  archivedAt: Date | null = null,
): TaskProgressAgent {
  return { id, workspaceId, tasks, updatedAt: new Date(updatedAt), archivedAt };
}

describe("resolveSessionTasks", () => {
  it("prefers the snapshot, which does not depend on the loaded timeline window", () => {
    expect(resolveSessionTasks([todo("snapshot")], [todo("timeline")])).toEqual([
      todo("snapshot"),
    ]);
  });

  it("falls back to the timeline for older hosts and lists that predate tracking", () => {
    expect(resolveSessionTasks(undefined, [todo("timeline")])).toEqual([todo("timeline")]);
    expect(resolveSessionTasks([], [todo("timeline")])).toEqual([todo("timeline")]);
    expect(resolveSessionTasks(undefined, undefined)).toBeUndefined();
  });
});

describe("summarizeOpenTasks", () => {
  it("counts progress and names the in-progress task in its present-tense form", () => {
    expect(
      summarizeOpenTasks([done("Read"), doing("Write tests", "Writing tests"), todo("Ship")]),
    ).toEqual({ completed: 1, total: 3, active: "Writing tests" });
  });

  it("treats legacy completed flags without a status as done", () => {
    expect(summarizeOpenTasks([{ text: "Old", completed: true }, todo("New")])).toEqual({
      completed: 1,
      total: 2,
      active: null,
    });
  });

  it("is null for an empty or finished list", () => {
    expect(summarizeOpenTasks(undefined)).toBeNull();
    expect(summarizeOpenTasks([])).toBeNull();
    expect(summarizeOpenTasks([done("a"), done("b")])).toBeNull();
  });
});

describe("workspace task progress", () => {
  it("sums open lists per workspace and skips archived, finished and unplaced chats", () => {
    const select = createWorkspaceTaskProgressSelector<TaskProgressAgent>();
    const agents = new Map(
      [
        agent("a", "ws", [done("1"), doing("2")], 10),
        agent("b", "ws", [todo("3"), doing("4", "Doing four")], 20),
        agent("c", "ws", [done("5")], 30),
        agent("d", "ws", [todo("6")], 40, new Date(1)),
        agent("e", undefined, [todo("7")], 50),
        agent("f", "other", [todo("8")], 60),
      ].map((row) => [row.id, row]),
    );
    expect(select(agents, "ws")).toEqual({ completed: 1, total: 4, active: "Doing four" });
    expect(select(agents, "other")).toEqual({ completed: 0, total: 1, active: null });
    expect(select(agents, "empty")).toBeNull();
    expect(select(undefined, "ws")).toBeNull();
  });

  it("compares progress by content so unrelated directory changes do not repaint a row", () => {
    expect(
      sameTaskProgress({ completed: 1, total: 2, active: null }, {
        completed: 1,
        total: 2,
        active: null,
      }),
    ).toBe(true);
    expect(sameTaskProgress(null, null)).toBe(true);
    expect(sameTaskProgress(null, { completed: 0, total: 1, active: null })).toBe(false);
  });
});
