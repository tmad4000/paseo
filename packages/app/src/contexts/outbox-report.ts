import { Platform } from "react-native";

import { getIsElectron } from "@/constants/platform";
import type { PendingQueueEnqueue } from "@/stores/queue-outbox-store/model";
import type { PendingDirectSend } from "@/stores/send-outbox-store/model";

export interface OutboxReportAgent {
  agentId: string;
  unsentQueued: number;
  unsentDirect: number;
  oldestCreatedAt?: string;
}

/**
 * Per-agent unsent counts for one host. Removal intents are not unsent messages,
 * so they are left out. See docs/queue-mirroring.md, "Delivery inspection".
 */
export function buildOutboxReportAgents(input: {
  serverId: string;
  queued: readonly PendingQueueEnqueue[];
  direct: readonly PendingDirectSend[];
}): OutboxReportAgent[] {
  const byAgent = new Map<string, { queued: number; direct: number; oldest: number }>();
  const add = (agentId: string, kind: "queued" | "direct", createdAt: number) => {
    const current = byAgent.get(agentId) ?? { queued: 0, direct: 0, oldest: createdAt };
    current[kind] += 1;
    current.oldest = Math.min(current.oldest, createdAt);
    byAgent.set(agentId, current);
  };
  for (const entry of input.queued) {
    if (entry.serverId !== input.serverId || entry.removalRequested) continue;
    add(entry.agentId, "queued", entry.createdAt);
  }
  for (const entry of input.direct) {
    if (entry.serverId !== input.serverId) continue;
    add(entry.agentId, "direct", entry.createdAt);
  }
  return [...byAgent.entries()].map(([agentId, counts]) => ({
    agentId,
    unsentQueued: counts.queued,
    unsentDirect: counts.direct,
    oldestCreatedAt: new Date(counts.oldest).toISOString(),
  }));
}

/** A coarse, untranslated device label for host-side diagnostics such as `paseo queue ls`. */
export function describeThisDevice(): { deviceLabel: string; platform: string } {
  if (getIsElectron()) return { deviceLabel: "Desktop app", platform: "desktop" };
  if (Platform.OS === "ios") {
    return { deviceLabel: Platform.isPad ? "iPad" : "iPhone", platform: "ios" };
  }
  if (Platform.OS === "android") return { deviceLabel: "Android", platform: "android" };
  return { deviceLabel: "Web browser", platform: "web" };
}
