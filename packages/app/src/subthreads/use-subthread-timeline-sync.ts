import { useEffect, useLayoutEffect } from "react";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";

/**
 * Reports the subthread the drawer shows to the host's viewed-timeline sync, under the
 * drawer's own owner key, so its chat catches up and stays live beside the parent. Mirrors
 * the workspace screen and Views; other owners' visible agents are untouched.
 */
export function useSubthreadTimelineSync(input: {
  ownerKey: string;
  serverId: string;
  agentId: string | null;
}): void {
  const { ownerKey, serverId, agentId } = input;
  const viewedTimelineSync = useSessionStore(
    (state) => state.sessions[serverId]?.viewedTimelineSync ?? null,
  );

  useEffect(() => {
    if (!agentId) return;
    void getHostRuntimeStore()
      .prepareAgentTimeline(serverId, agentId)
      .catch(() => undefined);
  }, [agentId, serverId]);

  useLayoutEffect(() => {
    if (!viewedTimelineSync) return;
    viewedTimelineSync.replaceVisibleAgentIds(ownerKey, agentId ? [agentId] : []);
  }, [agentId, ownerKey, viewedTimelineSync]);

  useEffect(() => {
    if (!viewedTimelineSync) return;
    return () => viewedTimelineSync.replaceVisibleAgentIds(ownerKey, []);
  }, [ownerKey, viewedTimelineSync]);
}
