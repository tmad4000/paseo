import type { Agent } from "@/stores/session-store";
import type { TodoEntry } from "@/types/stream";

/**
 * An agent's task list is its own plan (Claude's TodoWrite/Task tools, Codex plan updates), kept
 * apart from Stream asks, which are the user's commitments. The daemon carries the latest list on
 * the agent snapshot; the open chat can also derive it from the timeline it has loaded.
 */

export function isTaskDone(task: TodoEntry): boolean {
  return task.completed || task.status === "completed";
}

/**
 * The open chat's tasks. The snapshot copy wins because it does not depend on how much of the
 * timeline is loaded. An empty snapshot defers to the timeline: older hosts never send one, and a
 * stored chat whose list predates the host tracking it still has it in history.
 */
export function resolveSessionTasks(
  snapshotTasks: TodoEntry[] | undefined,
  timelineTasks: TodoEntry[] | undefined,
): TodoEntry[] | undefined {
  if (snapshotTasks && snapshotTasks.length > 0) return snapshotTasks;
  // COMPAT(agentTaskSnapshot): added in v0.10.0-beta.24, remove after 2027-05-03 once daemon floor >= v0.10.0-beta.24.
  return timelineTasks;
}

export interface TaskProgress {
  completed: number;
  total: number;
  /** The task being worked on now, in the agent's present-tense wording when it gave one. */
  active: string | null;
}

/** Null once every task is done: a finished plan is history, not a running list. */
export function summarizeOpenTasks(tasks: readonly TodoEntry[] | undefined): TaskProgress | null {
  if (!tasks?.length) return null;
  let completed = 0;
  let active: string | null = null;
  for (const task of tasks) {
    if (isTaskDone(task)) completed += 1;
    else if (active === null && task.status === "in_progress") {
      active = task.activeForm ?? task.text;
    }
  }
  if (completed === tasks.length) return null;
  return { completed, total: tasks.length, active };
}

export type TaskProgressAgent = Pick<
  Agent,
  "id" | "workspaceId" | "archivedAt" | "tasks" | "updatedAt"
>;

export function sameTaskProgress(a: TaskProgress | null, b: TaskProgress | null): boolean {
  if (!a || !b) return a === b;
  return a.completed === b.completed && a.total === b.total && a.active === b.active;
}

/**
 * A workspace's running task lists, summed over its unarchived chats that still have open tasks.
 * The active task comes from the most recently updated chat. Each immutable host directory is
 * indexed once rather than rescanned for every row; rows compare with `sameTaskProgress`.
 */
export function createWorkspaceTaskProgressSelector<T extends TaskProgressAgent>() {
  const cache = new WeakMap<ReadonlyMap<string, T>, ReadonlyMap<string, TaskProgress>>();
  return (agents: ReadonlyMap<string, T> | undefined, workspaceId: string): TaskProgress | null => {
    if (!agents) return null;
    let index = cache.get(agents);
    if (!index) {
      const sums = new Map<string, TaskProgress & { activeAt: number }>();
      for (const agent of agents.values()) {
        if (agent.archivedAt || !agent.workspaceId) continue;
        const progress = summarizeOpenTasks(agent.tasks);
        if (!progress) continue;
        const at = agent.updatedAt.getTime();
        const sum = sums.get(agent.workspaceId);
        if (!sum) {
          sums.set(agent.workspaceId, { ...progress, activeAt: progress.active ? at : -Infinity });
          continue;
        }
        sum.completed += progress.completed;
        sum.total += progress.total;
        if (progress.active && at > sum.activeAt) {
          sum.active = progress.active;
          sum.activeAt = at;
        }
      }
      const next = new Map<string, TaskProgress>();
      for (const [id, { completed, total, active }] of sums) {
        next.set(id, { completed, total, active });
      }
      index = next;
      cache.set(agents, index);
    }
    return index.get(workspaceId) ?? null;
  };
}

export const workspaceTaskProgress = createWorkspaceTaskProgressSelector<Agent>();
