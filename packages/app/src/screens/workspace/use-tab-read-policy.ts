import { useCallback, useMemo } from "react";
import { useSettings } from "@/hooks/use-settings";
import { agentReadMarkKey, useAgentReadMarksStore } from "@/stores/agent-read-marks-store";
import { useSessionStore } from "@/stores/session-store";
import { hasClearableAgentAttention } from "@/workspace/mark-read";
import type { TabReadPolicy } from "@/screens/workspace/workspace-tab-activity";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";

/**
 * How a tab strip decides its unread dots: the "Mark chats read when opened" setting, this
 * device's explicit read marks, and the host attention of the agents it shows. Tabs without a scope belong to
 * `fallbackServerId`.
 */
export function useTabReadPolicy(
  tabs: readonly WorkspaceTabDescriptor[],
  fallbackServerId: string | null,
): TabReadPolicy {
  const viewingMarksRead = useSettings((settings) => settings.markReadOnOpen);
  const readThroughByAgentKey = useAgentReadMarksStore((state) => state.readThroughByAgentKey);
  // A joined id list keeps the selector's result stable across unrelated session updates.
  const attentionKey = useSessionStore(
    useCallback(
      (state) => {
        const ids: string[] = [];
        for (const tab of tabs) {
          if (tab.target.kind !== "agent") continue;
          const serverId = tab.scope?.serverId ?? fallbackServerId;
          const agent = serverId
            ? state.sessions[serverId]?.agents?.get(tab.target.agentId)
            : undefined;
          if (hasClearableAgentAttention(agent)) ids.push(tab.target.agentId);
        }
        return ids.join("\n");
      },
      [fallbackServerId, tabs],
    ),
  );
  const attentionAgentIds = useMemo(
    () => new Set(attentionKey ? attentionKey.split("\n") : []),
    [attentionKey],
  );
  return useMemo(() => {
    const readThroughByAgentId = new Map<string, number>();
    for (const tab of tabs) {
      if (tab.target.kind !== "agent") continue;
      const serverId = tab.scope?.serverId ?? fallbackServerId;
      if (!serverId) continue;
      const readThrough = readThroughByAgentKey.get(agentReadMarkKey(serverId, tab.target.agentId));
      if (readThrough !== undefined) readThroughByAgentId.set(tab.target.agentId, readThrough);
    }
    return { viewingMarksRead, readThroughByAgentId, attentionAgentIds };
  }, [attentionAgentIds, fallbackServerId, readThroughByAgentKey, tabs, viewingMarksRead]);
}
