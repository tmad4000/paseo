import type { CompanionEntry } from "@getpaseo/protocol/companion-stream";
import { useMemo, useRef } from "react";
import { useSessionStore, type Agent } from "@/stores/session-store";
import {
  delegationTargetKey,
  deriveDelegationPulse,
  selectDelegatedHere,
  selectUntrackedChildren,
  toDelegationChildSnapshot,
  trackedChildIds,
  type DelegatedChild,
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
  { tracked = true }: { tracked?: boolean } = {},
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
        deriveDelegationPulse(snapshots[index] ?? null, { tracked }),
      ]),
    );
    return (target: DelegationTarget) =>
      byKey.get(delegationTargetKey(target)) ?? deriveDelegationPulse(null, { tracked });
  }, [snapshotsKey, targets, tracked]);
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

const NO_CHILDREN: DelegatedChild[] = [];

/**
 * Chats this one started that no ask here tracks, from the host's parent label on every agent it
 * creates for another. Recomputed only when the agent map or this chat's entries change.
 */
export function useUntrackedChildren(
  serverId: string,
  agentId: string,
  entries: readonly CompanionEntry[],
  enabled: boolean,
): DelegatedChild[] {
  const tracked = useMemo(
    () => trackedChildIds(entries, serverId, agentId),
    [agentId, entries, serverId],
  );
  // Agent maps are replaced on every change, so scan once per map and tracked set, not per render.
  const cache = useRef<{
    agents: Map<string, Agent>;
    tracked: Set<string>;
    key: string;
  } | null>(null);
  const key = useSessionStore((state) => {
    if (!enabled) return "";
    const agents = state.sessions[serverId]?.agents;
    if (!agents) return "";
    const hit = cache.current;
    if (hit && hit.agents === agents && hit.tracked === tracked) return hit.key;
    const children = selectUntrackedChildren(agents.values(), agentId, tracked);
    const next = children.length > 0 ? JSON.stringify(children) : "";
    cache.current = { agents, tracked, key: next };
    return next;
  });
  return useMemo(() => (key ? (JSON.parse(key) as DelegatedChild[]) : NO_CHILDREN), [key]);
}

/** An untracked child of this chat with its live state. */
export interface DelegatedChildPulse {
  child: DelegatedChild;
  target: DelegationTarget;
  pulse: DelegationPulse;
}

const NO_ENTRIES: CompanionEntry[] = [];
const NO_CHILD_PULSES: DelegatedChildPulse[] = [];

/**
 * The chats this one delegated to without an ask, live, the ones that need the delegator first
 * (a permission, an error, or an open question for a person), then newest.
 */
export function useDelegatedChildren(
  serverId: string,
  agentId: string,
  enabled: boolean,
): DelegatedChildPulse[] {
  const entries = useSessionStore((state) => {
    const session = state.sessions[serverId];
    return (
      (session?.agents.get(agentId) ?? session?.agentDetails.get(agentId))?.companionEntries ??
      NO_ENTRIES
    );
  });
  const children = useUntrackedChildren(serverId, agentId, entries, enabled);
  const targets = useMemo(
    () => children.map((child) => ({ serverId, agentId: child.agentId })),
    [children, serverId],
  );
  const pulses = useDelegationPulses(targets, { tracked: false });
  return useMemo(() => {
    if (children.length === 0) return NO_CHILD_PULSES;
    const rows = children.map((child, index) => ({
      child,
      target: targets[index]!,
      pulse: pulses(targets[index]!),
    }));
    // Stable sort: attention first, otherwise newest first as selected.
    return rows.sort((a, b) => Number(b.pulse.needsAttention) - Number(a.pulse.needsAttention));
  }, [children, pulses, targets]);
}
