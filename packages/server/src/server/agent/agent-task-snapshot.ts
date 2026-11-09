import type { AgentTaskItem } from "./agent-sdk-types.js";

/**
 * An agent's current task list rides on every agent snapshot so the sidebar can count it
 * without loading the chat. Providers keep their own lists short, but nothing stops a runaway
 * plan, so the snapshot copy is bounded; the full list still lives in the timeline.
 */
export const MAX_SNAPSHOT_TASKS = 50;
export const MAX_SNAPSHOT_TASK_TEXT = 240;

function clip(text: string): string {
  return text.length > MAX_SNAPSHOT_TASK_TEXT
    ? `${text.slice(0, MAX_SNAPSHOT_TASK_TEXT - 1)}…`
    : text;
}

/** The bounded snapshot copy of a provider's latest `todo` timeline item. */
export function toAgentTaskSnapshot(items: readonly AgentTaskItem[]): AgentTaskItem[] {
  return items.slice(0, MAX_SNAPSHOT_TASKS).map((item) => {
    const task: AgentTaskItem = { text: clip(item.text), completed: item.completed };
    if (item.id) task.id = item.id;
    if (item.status) task.status = item.status;
    if (item.activeForm) task.activeForm = clip(item.activeForm);
    return task;
  });
}

/** The stored or carried-over list; records written before tasks were tracked have none. */
export function restoreAgentTasks(source?: { tasks?: AgentTaskItem[] }): AgentTaskItem[] {
  return source?.tasks ?? [];
}

export function sameAgentTaskSnapshot(
  a: readonly AgentTaskItem[] | undefined,
  b: readonly AgentTaskItem[] | undefined,
): boolean {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) return false;
  return left.every((item, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      item.text === other.text &&
      item.completed === other.completed &&
      item.id === other.id &&
      item.status === other.status &&
      item.activeForm === other.activeForm
    );
  });
}
