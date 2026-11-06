import { useEffect, useMemo, useState } from "react";
import { useAppActivelyVisible } from "@/hooks/use-app-visible";
import { useSettings } from "@/hooks/use-settings";
import { useAgentReadMarksStore } from "@/stores/agent-read-marks-store";
import { useSessionStore } from "@/stores/session-store";
import { readAgentSeenClock } from "@/workspace/mark-read";
import { TAB_SEEN_DWELL_MS } from "@/screens/workspace/workspace-tab-activity";

export interface SeenDwellCandidate {
  tabId: string;
  serverId: string;
  agentId: string;
}

const EMPTY_DWELLED: ReadonlySet<string> = new Set();

/**
 * The "seen" half of two-level read status. A tab counts as seen once it has been the focused
 * pane's tab, in a focused window, for `TAB_SEEN_DWELL_MS` without interruption — long enough to
 * have been looked at, short of flicking past it with Ctrl+Tab. While it stays on screen this
 * device's seen mark follows the agent's seen clock, so every tab strip, the sidebar and the
 * switcher show the same ring.
 *
 * Returns the tabs that have dwelled, for `reconcileTabActivity`. Disabled in the legacy
 * "Mark chats read when opened" mode, where viewing already reads.
 */
export function useTabSeenDwell(input: {
  candidate: SeenDwellCandidate | null;
  enabled: boolean;
}): ReadonlySet<string> {
  const { candidate, enabled } = input;
  const viewingMarksRead = useSettings((settings) => settings.markReadOnOpen);
  const appActive = useAppActivelyVisible();
  const active = enabled && appActive && !viewingMarksRead ? candidate : null;
  const tabId = active?.tabId ?? null;
  const serverId = active?.serverId ?? null;
  const agentId = active?.agentId ?? null;
  const [dwelledTabId, setDwelledTabId] = useState<string | null>(null);

  useEffect(() => {
    setDwelledTabId(null);
    if (!tabId) return;
    const timer = setTimeout(() => setDwelledTabId(tabId), TAB_SEEN_DWELL_MS);
    return () => clearTimeout(timer);
  }, [tabId, serverId, agentId]);

  const dwelled = dwelledTabId !== null && dwelledTabId === tabId;

  useEffect(() => {
    if (!dwelled || !serverId || !agentId) return;
    const mark = () => {
      const seenAt = readAgentSeenClock(useSessionStore.getState(), serverId, agentId);
      useAgentReadMarksStore.getState().markSeenThrough({ serverId, agentId, seenAt });
    };
    mark();
    // Activity and attention that land while the reader is watching are seen too.
    return useSessionStore.subscribe(mark);
  }, [agentId, dwelled, serverId]);

  return useMemo(() => (dwelled && tabId ? new Set([tabId]) : EMPTY_DWELLED), [dwelled, tabId]);
}
