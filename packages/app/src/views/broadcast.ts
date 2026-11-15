import { dispatchComposerAgentMessage } from "@/composer/actions";
import { createDirectSendOutbox } from "@/composer/submission/direct-send-outbox";
import { createMessageSubmissionWriter } from "@/composer/submission/writer";
import { getHostRuntimeStore, isHostRuntimeConnected } from "@/runtime/host-runtime";
import { flushQueueOutboxForServer, useQueueOutboxStore } from "@/stores/queue-outbox-store";
import { selectAgentTurnPresentation, useSessionStore } from "@/stores/session-store";
import { generateMessageId } from "@/types/stream";
import {
  planBroadcast,
  type BroadcastPlanEntry,
  type BroadcastTarget,
} from "@/views/broadcast-plan";

export interface BroadcastResult {
  sent: number;
  pending: number;
  queued: number;
  skipped: number;
  failed: number;
}

export function planBroadcastForCurrentState(targets: BroadcastTarget[]): BroadcastPlanEntry[] {
  const runtime = getHostRuntimeStore();
  const sessions = useSessionStore.getState().sessions;
  return planBroadcast(targets, {
    isConnected: (serverId) =>
      Boolean(runtime.getClient(serverId)) && isHostRuntimeConnected(runtime.getSnapshot(serverId)),
    isBusy: (target) =>
      selectAgentTurnPresentation(sessions[target.serverId], target.agentId).isActive,
    supportsQueue: (serverId) =>
      sessions[serverId]?.serverInfo?.features?.agentMessageQueue === true,
  });
}

export async function runBroadcast(
  text: string,
  plan: BroadcastPlanEntry[],
): Promise<BroadcastResult> {
  const result: BroadcastResult = { sent: 0, pending: 0, queued: 0, skipped: 0, failed: 0 };
  const trimmed = text.trim();
  if (!trimmed) return result;
  const runtime = getHostRuntimeStore();
  const queuedServers = new Set<string>();

  await Promise.all(
    plan.map(async (entry) => {
      const client = runtime.getClient(entry.serverId);
      if (entry.delivery === "skip" || !client) {
        result.skipped += 1;
        return;
      }
      try {
        if (entry.delivery === "send") {
          const outbox = createDirectSendOutbox(entry.serverId, client);
          let hostQueued = false;
          await dispatchComposerAgentMessage({
            serverId: entry.serverId,
            outbox,
            deliveryClient: client,
            client: {
              uploadFile: (input) => client.uploadFile(input),
              sendAgentMessage: async (agentId, prompt, options) => {
                const response = await client.sendAgentMessage(agentId, prompt, options);
                hostQueued = response.queued;
                return response;
              },
            },
            agentId: entry.agentId,
            text: trimmed,
            attachments: [],
            encodeImages: async () => undefined,
            submission: createMessageSubmissionWriter(entry.serverId),
          });
          if (outbox) result.pending += 1;
          else if (hostQueued) result.queued += 1;
          else result.sent += 1;
          return;
        }
        await useQueueOutboxStore.getState().add({
          serverId: entry.serverId,
          agentId: entry.agentId,
          itemId: generateMessageId(),
          text: trimmed,
          images: [],
          attachments: [],
          composerAttachments: [],
        });
        queuedServers.add(entry.serverId);
        result.pending += 1;
      } catch {
        result.failed += 1;
      }
    }),
  );

  void Promise.all(
    [...queuedServers].map(async (serverId) => {
      const client = runtime.getClient(serverId);
      if (!client) return;
      await flushQueueOutboxForServer({
        serverId,
        client,
        applySnapshot: (snapshot) =>
          useSessionStore.getState().applyAgentQueueSnapshot(serverId, snapshot),
      }).catch(() => undefined);
    }),
  );
  return result;
}
