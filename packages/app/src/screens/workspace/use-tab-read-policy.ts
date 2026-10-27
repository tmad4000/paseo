import { useMemo } from "react";
import { useSettings } from "@/hooks/use-settings";
import { agentReadMarkKey, useAgentReadMarksStore } from "@/stores/agent-read-marks-store";
import type { TabReadPolicy } from "@/screens/workspace/workspace-tab-activity";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";

/**
 * How a tab strip decides its unread dots: the "Mark chats read when opened" setting plus this
 * device's explicit read marks for the agents it shows. Tabs without a scope belong to
 * `fallbackServerId`.
 */
export function useTabReadPolicy(
  tabs: readonly WorkspaceTabDescriptor[],
  fallbackServerId: string | null,
): TabReadPolicy {
  const viewingMarksRead = useSettings((settings) => settings.markReadOnOpen);
  const readThroughByAgentKey = useAgentReadMarksStore((state) => state.readThroughByAgentKey);
  return useMemo(() => {
    const readThroughByAgentId = new Map<string, number>();
    for (const tab of tabs) {
      if (tab.target.kind !== "agent") continue;
      const serverId = tab.scope?.serverId ?? fallbackServerId;
      if (!serverId) continue;
      const readThrough = readThroughByAgentKey.get(agentReadMarkKey(serverId, tab.target.agentId));
      if (readThrough !== undefined) readThroughByAgentId.set(tab.target.agentId, readThrough);
    }
    return { viewingMarksRead, readThroughByAgentId };
  }, [fallbackServerId, readThroughByAgentKey, tabs, viewingMarksRead]);
}
