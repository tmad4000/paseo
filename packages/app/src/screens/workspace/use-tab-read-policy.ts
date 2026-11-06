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
  const seenThroughByAgentKey = useAgentReadMarksStore((state) => state.seenThroughByAgentKey);
  // A joined "id<TAB>attentionAt" list keeps the selector's result stable across unrelated
  // session updates.
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
          if (hasClearableAgentAttention(agent)) {
            const attentionAt = agent?.attentionTimestamp?.getTime() ?? 0;
            ids.push(`${tab.target.agentId}\t${Number.isFinite(attentionAt) ? attentionAt : 0}`);
          }
        }
        return ids.join("\n");
      },
      [fallbackServerId, tabs],
    ),
  );
  const { attentionAgentIds, attentionAtByAgentId } = useMemo(() => {
    const ids = new Set<string>();
    const attentionAt = new Map<string, number>();
    for (const entry of attentionKey ? attentionKey.split("\n") : []) {
      const [agentId, at] = entry.split("\t");
      if (!agentId) continue;
      ids.add(agentId);
      attentionAt.set(agentId, Number(at) || 0);
    }
    return { attentionAgentIds: ids, attentionAtByAgentId: attentionAt };
  }, [attentionKey]);
  return useMemo(() => {
    const readThroughByAgentId = new Map<string, number>();
    const seenThroughByAgentId = new Map<string, number>();
    for (const tab of tabs) {
      if (tab.target.kind !== "agent") continue;
      const serverId = tab.scope?.serverId ?? fallbackServerId;
      if (!serverId) continue;
      const key = agentReadMarkKey(serverId, tab.target.agentId);
      const readThrough = readThroughByAgentKey.get(key);
      if (readThrough !== undefined) readThroughByAgentId.set(tab.target.agentId, readThrough);
      const seenThrough = seenThroughByAgentKey.get(key);
      if (seenThrough !== undefined) seenThroughByAgentId.set(tab.target.agentId, seenThrough);
    }
    return {
      viewingMarksRead,
      readThroughByAgentId,
      attentionAgentIds,
      seenThroughByAgentId,
      attentionAtByAgentId,
    };
  }, [
    attentionAgentIds,
    attentionAtByAgentId,
    fallbackServerId,
    readThroughByAgentKey,
    seenThroughByAgentKey,
    tabs,
    viewingMarksRead,
  ]);
}
