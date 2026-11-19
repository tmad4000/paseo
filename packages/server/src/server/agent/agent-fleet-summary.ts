import {
  AGENT_FLEET_SUMMARY_VISIT_LIMIT,
  type AgentFleetSummaryResponse,
} from "@getpaseo/protocol/messages";
import type { ManagedAgent } from "./agent-manager.js";

type FleetSummary = Omit<AgentFleetSummaryResponse["payload"], "requestId" | "serverId">;
type FleetState = FleetSummary["root"]["state"];
type FleetAgent = Pick<ManagedAgent, "lifecycle" | "internal" | "attention"> & {
  pendingPermissions: { readonly size: number };
};

function classify(agent: FleetAgent | undefined): FleetState | null {
  if (!agent || agent.internal || agent.lifecycle === "closed") return null;
  const { attention, lifecycle } = agent;
  const reason = attention.requiresAttention === true ? attention.attentionReason : undefined;
  if (agent.pendingPermissions.size > 0 || reason === "permission") return "needsPermission";
  if (lifecycle === "error" || (lifecycle === "idle" && reason === "error")) return "blocked";
  if (lifecycle === "running" || lifecycle === "initializing" || lifecycle === "idle") {
    return lifecycle;
  }
  return "unknown";
}

export function summarizeLoadedFleet(
  agents: ReadonlyMap<string, FleetAgent>,
  agentId: string,
): FleetSummary {
  const observedAt = Math.floor(Date.now() / 1000);
  const scope = "loaded-noninternal-nonclosed-v1";
  try {
    const counts = {
      running: 0,
      idle: 0,
      blocked: 0,
      needsPermission: 0,
      initializing: 0,
      unknown: 0,
    };
    const complete = agents.size <= AGENT_FLEET_SUMMARY_VISIT_LIMIT;
    // Reserve one visit on a partial read for the exact root, even if it is beyond the scan.
    const scanLimit = complete
      ? AGENT_FLEET_SUMMARY_VISIT_LIMIT
      : AGENT_FLEET_SUMMARY_VISIT_LIMIT - 1;
    let visited = 0;
    let seen = 0;
    let rootState: FleetState = "unknown";
    for (const [id, agent] of agents) {
      const state = classify(agent);
      if (state !== null) {
        counts[state]++;
        seen++;
        if (id === agentId) rootState = state;
      }
      if (++visited === scanLimit) break;
    }
    if (!complete) rootState = classify(agents.get(agentId)) ?? "unknown";
    return {
      observedAt,
      scope,
      availability: complete ? "ok" : "partial",
      coverage: { seen, total: complete ? seen : null, complete },
      counts,
      root: { agentId, state: rootState },
      error: null,
    };
  } catch {
    return {
      observedAt,
      scope,
      availability: "unavailable",
      coverage: { seen: 0, total: null, complete: false },
      counts: null,
      root: { agentId, state: "unknown" },
      error: "unavailable",
    };
  }
}
