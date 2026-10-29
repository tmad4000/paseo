import type { CompanionEntry } from "@getpaseo/protocol/companion-stream";
import { useMemo } from "react";
import { useSessionStore, type Agent } from "@/stores/session-store";
import {
  delegationTargetKey,
  deriveDelegationPulse,
  selectDelegatedHere,
  toDelegationChildSnapshot,
  type DelegatedHereAsk,
  type DelegationPulse,
  type DelegationTarget,
} from "./delegation-pulse";
import { splitEntryText } from "./entry-labels";

/**
 * Live pulses for the children working a chat's asks. One serialized selector over just the
 * fields the pulse reads, so a row re-renders when its child changes state and not on unrelated
 * session updates. Updates arrive with the host's agent pushes; nothing here polls.
 */
export function useDelegationPulses(
  targets: readonly DelegationTarget[],
): (target: DelegationTarget) => DelegationPulse {
  const snapshotsKey = useSessionStore((state) =>
    JSON.stringify(
      targets.map((target) => {
        const session = state.sessions[target.serverId];
        return toDelegationChildSnapshot(
          session?.agents.get(target.agentId) ?? session?.agentDetails.get(target.agentId),
        );
      }),
    ),
  );
  return useMemo(() => {
    const snapshots = JSON.parse(snapshotsKey) as ReturnType<typeof toDelegationChildSnapshot>[];
    const byKey = new Map(
      targets.map((target, index) => [
        delegationTargetKey(target),
        deriveDelegationPulse(snapshots[index] ?? null),
      ]),
    );
    return (target: DelegationTarget) =>
      byKey.get(delegationTargetKey(target)) ?? deriveDelegationPulse(null);
  }, [snapshotsKey, targets]);
}

export function useDelegationPulse(target: DelegationTarget | null): DelegationPulse | null {
  const targets = useMemo(() => (target ? [target] : []), [target]);
  const pulses = useDelegationPulses(targets);
  return target ? pulses(target) : null;
}

const NO_DELEGATED_HERE: DelegatedHereAsk[] = [];
// Agent maps are replaced on every change, so the scan runs once per map, not once per render.
const delegatedHereCache = new WeakMap<Map<string, Agent>, Map<string, string>>();

function headline(entry: CompanionEntry): string {
  return splitEntryText(entry.text).headline || entry.text;
}

/**
 * Asks other chats on this host delegated to this one, for the child's link back to the chat
 * that owns the loop.
 */
export function useDelegatedHere(
  serverId: string,
  agentId: string,
  enabled: boolean,
): DelegatedHereAsk[] {
  const key = useSessionStore((state) => {
    if (!enabled) return "";
    const agents = state.sessions[serverId]?.agents;
    if (!agents) return "";
    let byChild = delegatedHereCache.get(agents);
    if (!byChild) {
      byChild = new Map();
      delegatedHereCache.set(agents, byChild);
    }
    let cached = byChild.get(agentId);
    if (cached === undefined) {
      const items = selectDelegatedHere(agents.values(), serverId, agentId, headline);
      cached = items.length > 0 ? JSON.stringify(items) : "";
      byChild.set(agentId, cached);
    }
    return cached;
  });
  return useMemo(() => (key ? (JSON.parse(key) as DelegatedHereAsk[]) : NO_DELEGATED_HERE), [key]);
}
