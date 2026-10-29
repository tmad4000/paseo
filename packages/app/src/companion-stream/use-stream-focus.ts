import { useEffect, useRef } from "react";
import { useAgentViewStore, type StreamFocusRequest } from "@/stores/agent-view-store";

/**
 * Applies a request to show one entry's card in a chat's Stream (for example from Chat's
 * floating pane), then clears it so the request is applied once. The search it set stays until
 * the user clears it.
 */
export function useApplyStreamFocus(
  scope: { serverId: string; agentId: string } | undefined,
  apply: (focus: StreamFocusRequest) => void,
): void {
  const key = scope ? `${scope.serverId}:${scope.agentId}` : "";
  const focus = useAgentViewStore((state) => (key ? state.streamFocus[key] : undefined));
  const clear = useAgentViewStore((state) => state.clearStreamFocus);
  const applyRef = useRef(apply);
  applyRef.current = apply;
  useEffect(() => {
    if (!focus || !scope) return;
    applyRef.current(focus);
    clear(scope.serverId, scope.agentId, focus.requestId);
  }, [clear, focus, scope]);
}
