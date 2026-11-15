import { useCallback } from "react";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { useSubthreadsHost } from "./context";

export interface AgentTarget {
  serverId: string;
  agentId: string;
}

/**
 * Opens an agent from inside a parent's pane, peek-first: one of this chat's subagents (same
 * host, listed in its registry) shows beside the chat; anything else keeps today's way in, its
 * own tab or session. `tab` skips the peek (Mod+click and middle-click on web). Inside a peeked
 * child there is no host, so its own links open tabs.
 */
export function usePeekOrOpenAgent(serverId: string) {
  const host = useSubthreadsHost();
  return useCallback(
    (target: AgentTarget, options?: { tab?: boolean }) => {
      const peeked =
        !options?.tab &&
        target.serverId === serverId &&
        host !== null &&
        host.peek({ kind: "paseo", id: target.agentId });
      if (!peeked) navigateToAgent({ serverId: target.serverId, agentId: target.agentId });
    },
    [host, serverId],
  );
}
