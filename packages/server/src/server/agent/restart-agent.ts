import type { Logger } from "pino";

import type { AgentQueueSnapshot } from "@getpaseo/protocol/messages";

import type { AgentQueueService, StalledHeadRecovery } from "../agent-queue/service.js";
import type { StoredQueuedMessage } from "../agent-queue/store.js";
import type { AgentManager, ManagedAgent } from "./agent-manager.js";
import type { AgentTimelineItem } from "./agent-sdk-types.js";

/**
 * Restart agent: restart the provider process, resume the same session (same
 * context, same timeline), then deliver whatever is queued, in order.
 *
 * This is the one-click recovery for a "stuck" agent: idle, with a queue that
 * never drains. Two things strand a queue (docs/queue-mirroring.md):
 *  1. Nothing drains at daemon startup, and drains otherwise fire only on a
 *     running → idle edge, which an already-idle agent never produces.
 *  2. A head item whose delivery receipt is `pending` (the daemon died
 *     mid-submit) is never retried automatically, so it blocks everything behind it.
 * Restart fixes both: it settles the stalled head against the timeline and
 * kicks the drain explicitly.
 *
 * Unlike "Reload agent" (refresh_agent_request) it does not wipe and re-stream
 * the timeline from provider history; it keeps the timeline, which is also what
 * lets it see whether the stalled message already reached the agent.
 */
export interface RestartAgentDependencies {
  agentManager: Pick<AgentManager, "getAgent" | "reloadAgentSession" | "getTimeline">;
  agentQueueService?: Pick<AgentQueueService, "list" | "recoverStalledHead" | "drainNow"> | null;
  /** Loads an agent that is not live (stored only). Defaults to the daemon's loader at call sites. */
  loadAgent: (agentId: string) => Promise<ManagedAgent>;
  logger: Logger;
}

export interface RestartAgentResult {
  agentId: string;
  /** `reloaded`: a live provider process was restarted. `resumed`: a stored agent was loaded. */
  mode: "reloaded" | "resumed";
  timelineSize: number;
  queue: {
    before: number;
    after: number;
    recoveredHead: StalledHeadRecovery | null;
    snapshot: AgentQueueSnapshot;
  } | null;
}

/** Was this queued item already submitted? Match the id the drain passes as clientMessageId. */
export function timelineHasQueuedMessage(
  timeline: readonly AgentTimelineItem[],
  item: Pick<StoredQueuedMessage, "id">,
): boolean {
  return timeline.some(
    (entry) =>
      entry.type === "user_message" &&
      (entry.messageId === item.id || entry.clientMessageId === item.id),
  );
}

export async function restartAgentCommand(
  dependencies: RestartAgentDependencies,
  agentId: string,
): Promise<RestartAgentResult> {
  const { agentManager, agentQueueService, logger } = dependencies;
  const live = agentManager.getAgent(agentId);
  let mode: RestartAgentResult["mode"];
  if (live && live.lifecycle !== "closed") {
    // reloadAgentSession cancels an in-flight run, closes the provider session
    // and resumes the same persisted thread, keeping labels and timeline.
    await agentManager.reloadAgentSession(agentId);
    mode = "reloaded";
  } else {
    await dependencies.loadAgent(agentId);
    mode = "resumed";
  }
  logger.info({ agentId, mode }, "Restarted agent");

  let queue: RestartAgentResult["queue"] = null;
  if (agentQueueService) {
    const before = (await agentQueueService.list(agentId)).items.length;
    const recoveredHead = await agentQueueService.recoverStalledHead(agentId, (item) =>
      timelineHasQueuedMessage(agentManager.getTimeline(agentId), item),
    );
    const snapshot =
      before > 0
        ? await agentQueueService.drainNow(agentId)
        : await agentQueueService.list(agentId);
    queue = { before, after: snapshot.items.length, recoveredHead, snapshot };
  }

  return {
    agentId,
    mode,
    timelineSize: agentManager.getTimeline(agentId).length,
    queue,
  };
}
