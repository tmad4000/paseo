import type { Agent } from "@/stores/session-store";
import { threadOriginOf } from "@/threads/model";

export type CloseAgentTabPolicy = { kind: "archive-on-close" } | { kind: "layout-only" };

/**
 * Closing a root agent's tab in its own workspace archives it. A subagent's tab, a thread's (it
 * stays reachable from its "N replies" chip), or a session shown in another workspace's split
 * (its home is elsewhere) only leaves the layout.
 */
export function resolveCloseAgentTabPolicy(
  agent:
    | (Pick<Agent, "parentAgentId" | "workspaceId"> & Partial<Pick<Agent, "labels">>)
    | null
    | undefined,
  layoutWorkspaceId?: string,
): CloseAgentTabPolicy {
  if (agent?.parentAgentId || threadOriginOf(agent)) {
    return { kind: "layout-only" };
  }
  if (layoutWorkspaceId && agent?.workspaceId && agent.workspaceId !== layoutWorkspaceId) {
    return { kind: "layout-only" };
  }

  return { kind: "archive-on-close" };
}
