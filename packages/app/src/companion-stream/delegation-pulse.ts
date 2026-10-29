import type { CompanionEntry } from "@getpaseo/protocol/companion-stream";
import type { Agent } from "@/stores/session-store";

type TrackedAsk = NonNullable<CompanionEntry["ask"]>;

/**
 * What a delegating chat shows about the child working its ask. Derived only from the child's
 * live agent snapshot, which the host pushes on every change, so it is current without polling.
 *
 * - `running`: a turn is open (or the host reports running).
 * - `permission`: the child is stopped on a permission request; it waits for a person.
 * - `idle`: the child is not working, yet the ask is still open. An idle child is not a finished
 *   ask, so this needs attention from the delegator.
 * - `error`: the child's last turn failed.
 * - `closed`: the child was closed or archived while the ask is still open.
 * - `starting`: the child is initializing.
 * - `unknown`: this client has no snapshot (another host, or an archived child it never loaded).
 */
export type DelegationPulseKind =
  | "running"
  | "permission"
  | "idle"
  | "error"
  | "closed"
  | "starting"
  | "unknown";

/** The few child fields the pulse reads; plain values so a selector can compare them cheaply. */
export interface DelegationChildSnapshot {
  status: Agent["status"];
  pendingPermissionCount: number;
  attentionReason: Agent["attentionReason"] | null;
  /** Start of the open turn, epoch ms. */
  turnStartedAt: number | null;
  /** Last snapshot change, epoch ms. */
  lastActivityAt: number | null;
  archived: boolean;
  title: string | null;
  lastError: string | null;
}

export interface DelegationPulse {
  kind: DelegationPulseKind;
  /** The child left its delegator something to do: decide, unblock, or close the ask. */
  needsAttention: boolean;
  /** Epoch ms the pulse's time is counted from: turn start when running, else last activity. */
  since: number | null;
  title: string | null;
  error: string | null;
}

export interface DelegationTarget {
  serverId: string;
  agentId: string;
}

const ATTENTION_KINDS: ReadonlySet<DelegationPulseKind> = new Set([
  "permission",
  "idle",
  "error",
  "closed",
]);

export function toDelegationChildSnapshot(
  agent: Agent | null | undefined,
): DelegationChildSnapshot | null {
  if (!agent) return null;
  return {
    status: agent.status,
    pendingPermissionCount: agent.pendingPermissions.length,
    attentionReason: agent.attentionReason ?? null,
    turnStartedAt: agent.turn.phase === "open" ? (agent.turn.startedAt?.getTime() ?? null) : null,
    lastActivityAt: agent.lastActivityAt?.getTime() ?? null,
    archived: Boolean(agent.archivedAt),
    title: agent.title?.trim() || null,
    lastError: agent.lastError?.trim() || null,
  };
}

function pulseKind(child: DelegationChildSnapshot): DelegationPulseKind {
  if (child.archived || child.status === "closed") return "closed";
  if (child.pendingPermissionCount > 0 || child.attentionReason === "permission") {
    return "permission";
  }
  if (child.status === "error" || child.attentionReason === "error") return "error";
  if (child.status === "running" || child.turnStartedAt !== null) return "running";
  if (child.status === "initializing") return "starting";
  return "idle";
}

/** The child's state as the delegating chat should see it while the ask is still open. */
export function deriveDelegationPulse(child: DelegationChildSnapshot | null): DelegationPulse {
  if (!child) {
    return { kind: "unknown", needsAttention: false, since: null, title: null, error: null };
  }
  const kind = pulseKind(child);
  return {
    kind,
    needsAttention: ATTENTION_KINDS.has(kind),
    since:
      kind === "running" ? (child.turnStartedAt ?? child.lastActivityAt) : child.lastActivityAt,
    title: child.title,
    error: kind === "error" ? child.lastError : null,
  };
}

/**
 * The session working an ask, from the chat that owns it: the managed child named by
 * `delegatedAgentId` on this host, else the newest linked session that is not the owning chat.
 * Done asks and linked duplicates have none; their state lives elsewhere.
 */
export function delegationTarget(
  ask: TrackedAsk | undefined,
  serverId: string,
  owningAgentId?: string,
): DelegationTarget | null {
  if (!ask || ask.state === "done" || ask.canonicalTask) return null;
  if (ask.delegatedAgentId) return { serverId, agentId: ask.delegatedAgentId };
  const owner = owningAgentId ?? ask.origin?.agentId;
  const sessions = ask.sessions ?? [];
  for (let index = sessions.length - 1; index >= 0; index -= 1) {
    const session = sessions[index]!;
    if (session.serverId === serverId && session.agentId === owner) continue;
    return { serverId: session.serverId, agentId: session.agentId };
  }
  return null;
}

export function delegationTargetKey(target: DelegationTarget): string {
  return `${target.serverId}\u0000${target.agentId}`;
}

/** An open ask, in another chat on this host, that this chat was delegated to work. */
export interface DelegatedHereAsk {
  ownerAgentId: string;
  ownerTitle: string | null;
  entryId: string;
  headline: string;
  state: Exclude<TrackedAsk["state"], "done">;
}

/**
 * Reverse links for a child: every unresolved ask on this host whose working session is this
 * chat. Reads only snapshots the client already holds; an owner outside them is not listed.
 */
export function selectDelegatedHere(
  agents: Iterable<Agent>,
  serverId: string,
  childAgentId: string,
  headlineOf: (entry: CompanionEntry) => string,
): DelegatedHereAsk[] {
  const items: DelegatedHereAsk[] = [];
  for (const agent of agents) {
    if (agent.id === childAgentId || agent.archivedAt) continue;
    for (const entry of agent.companionEntries ?? []) {
      const target = delegationTarget(entry.ask, serverId, agent.id);
      if (!target || target.serverId !== serverId || target.agentId !== childAgentId) continue;
      const state = entry.ask!.state;
      if (state === "done") continue;
      items.push({
        ownerAgentId: agent.id,
        ownerTitle: agent.title?.trim() || null,
        entryId: entry.id,
        headline: headlineOf(entry),
        state,
      });
    }
  }
  return items;
}

/** Stable key per ask and attention state, so a newly idle child brings a hidden pane back. */
export function delegationAttentionKey(entryId: string, pulse: DelegationPulse): string | null {
  return pulse.needsAttention ? `child:${entryId}:${pulse.kind}` : null;
}
