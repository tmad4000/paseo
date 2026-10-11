import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from "react";
import { useSessionStore } from "@/stores/session-store";
import { collectAllTabs, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { workspaceTabTargetsEqual } from "@/workspace-tabs/identity";
import { buildWorkspaceTabPersistenceKey, type WorkspaceTabTarget } from "@/workspace-tabs/model";
import {
  collectThreadReplies,
  NO_THREAD_REPLIES,
  threadRepliesEqual,
  type ThreadRepliesByAnchor,
} from "./model";

/**
 * What an agent's chat needs to offer threads: its replies' threads, where to open one, and the
 * layout that holds this chat. Provided by the agent panel only, so read-only surfaces (drafts,
 * provider subagents) show no thread controls.
 */
export interface ThreadsHost {
  serverId: string;
  parentAgentId: string;
  /** The workspace whose layout shows this chat; a new thread opens and lives there. */
  layoutWorkspaceId: string;
  repliesByAnchor: ThreadRepliesByAnchor;
  openThread: (threadAgentId: string) => void;
}

const ThreadsHostContext = createContext<ThreadsHost | null>(null);

export function useThreadsHost(): ThreadsHost | null {
  return useContext(ThreadsHostContext);
}

/**
 * Opens a thread beside the chat it came from. A thread that lives in another workspace (moved
 * there later) is kept in this layout by the explicit-open pin, as a split session would be.
 */
export function openThreadBeside(input: {
  serverId: string;
  layoutWorkspaceId: string;
  threadAgentId: string;
}): string | null {
  const workspaceKey = buildWorkspaceTabPersistenceKey({
    serverId: input.serverId,
    workspaceId: input.layoutWorkspaceId,
  });
  if (!workspaceKey) return null;
  const store = useWorkspaceLayoutStore.getState();
  const target: WorkspaceTabTarget = { kind: "agent", agentId: input.threadAgentId };
  const layout = store.layoutByWorkspace[workspaceKey];
  const alreadyOpen = Boolean(
    layout &&
    collectAllTabs(layout.root).some((tab) => workspaceTabTargetsEqual(tab.target, target)),
  );
  const session = useSessionStore.getState().sessions[input.serverId];
  const thread =
    session?.agents.get(input.threadAgentId) ?? session?.agentDetails.get(input.threadAgentId);
  const foreign = Boolean(thread?.workspaceId && thread.workspaceId !== input.layoutWorkspaceId);
  const paneId = alreadyOpen ? null : store.ensureSidePane(workspaceKey);
  return store.openTab({
    workspaceKey,
    target,
    intent: "reveal",
    placement: paneId ? { mode: "pane", paneId } : undefined,
    pin: foreign,
  });
}

function useThreadReplies(serverId: string, parentAgentId: string): ThreadRepliesByAnchor {
  // The agents map changes identity when any agent record changes, not on streamed text, so
  // grouping is recomputed only then; equal results keep their identity for the footers.
  const agents = useSessionStore((state) => state.sessions[serverId]?.agents);
  const previous = useRef<ThreadRepliesByAnchor>(NO_THREAD_REPLIES);
  return useMemo(() => {
    const next = agents ? collectThreadReplies(agents.values(), parentAgentId) : NO_THREAD_REPLIES;
    if (threadRepliesEqual(previous.current, next)) return previous.current;
    previous.current = next;
    return next;
  }, [agents, parentAgentId]);
}

export function ThreadsHostProvider({
  serverId,
  agentId,
  layoutWorkspaceId,
  children,
}: {
  serverId: string;
  agentId: string;
  layoutWorkspaceId: string;
  children: ReactNode;
}) {
  const repliesByAnchor = useThreadReplies(serverId, agentId);
  const openThread = useCallback(
    (threadAgentId: string) => {
      openThreadBeside({ serverId, layoutWorkspaceId, threadAgentId });
    },
    [layoutWorkspaceId, serverId],
  );
  const value = useMemo<ThreadsHost>(
    () => ({ serverId, parentAgentId: agentId, layoutWorkspaceId, repliesByAnchor, openThread }),
    [agentId, layoutWorkspaceId, openThread, repliesByAnchor, serverId],
  );
  return <ThreadsHostContext.Provider value={value}>{children}</ThreadsHostContext.Provider>;
}
