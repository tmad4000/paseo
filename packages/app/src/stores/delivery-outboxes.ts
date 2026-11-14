import {
  awaitSendOutboxHydration,
  flushSendOutboxEntriesForServer,
  isUncertainSendOutcome,
  useSendOutboxStore,
  type SendOutboxServerInput,
} from "@/stores/send-outbox-store";
import {
  awaitOutboxHydration,
  flushQueueOutboxEntriesForServer,
  useQueueOutboxStore,
  type QueueOutboxServerInput,
} from "@/stores/queue-outbox-store";
import { serializeQueueOperation, type QueueOutboxFlushClient } from "@/stores/queue-outbox-store/model";
import { supportsDurableDirectSend, type SendOutboxFlushClient } from "@/stores/send-outbox-store/model";
import { createDirectSendAcceptanceHandler } from "@/composer/submission/direct-send-outbox";
import { useSessionStore } from "@/stores/session-store";

import { awaitDeliveryOrderHydration, nextDeliveryCreatedAt } from "@/stores/delivery-order";

type DeliveryClient = Partial<SendOutboxFlushClient & QueueOutboxFlushClient>;
interface OrderedAdmission {
  serverId: string;
  agentId: string;
  itemId: string;
  createdAt: number;
  isPending?: () => Promise<boolean>;
  running?: boolean;
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  promise: Promise<unknown>;
}
const admissions = new Map<string, OrderedAdmission>();
const admissionKey = (serverId: string, itemId: string) => JSON.stringify([serverId, itemId]);

export async function runOrderedAdmission<T>(input: {
  serverId: string;
  agentId: string;
  itemId: string;
  createdAt?: number;
  client?: DeliveryClient;
  isPending?: () => Promise<boolean>;
  run: () => Promise<T>;
}): Promise<T> {
  await awaitDeliveryOrderHydration();
  const key = admissionKey(input.serverId, input.itemId);
  const existing = admissions.get(key);
  if (existing) return await existing.promise as T;
  let resolve!: (value: unknown) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<unknown>((accept, refuse) => { resolve = accept; reject = refuse; });
  const admission: OrderedAdmission = { ...input, createdAt: input.createdAt ?? nextDeliveryCreatedAt(), resolve, reject, promise };
  admissions.set(key, admission);
  void flushDeliveryOutboxes({ ...input, client: input.client ?? {} }).catch((error) => {
    if (admissions.get(key) === admission) {
      admissions.delete(key);
      reject(error);
    }
  });
  return await promise as T;
}

export async function flushDeliveryOutboxes(input: {
  serverId: string;
  agentId?: string;
  client: DeliveryClient;
  direct?: SendOutboxServerInput;
  queue?: QueueOutboxServerInput;
}): Promise<void> {
  await Promise.all([awaitSendOutboxHydration(), awaitOutboxHydration()]);
  const { serverId, client } = input;
  const directEntries = () => Object.values(useSendOutboxStore.getState().entries).filter(
    (entry) => entry.serverId === serverId &&
      (entry.rejectedError === undefined || isUncertainSendOutcome(entry.rejectedError)),
  );
  const queueEntries = () => Object.values(useQueueOutboxStore.getState().entries).filter(
    (entry) => entry.serverId === serverId,
  );
  const features = client.getLastServerInfoMessage?.()?.features ??
    useSessionStore.getState().sessions[serverId]?.serverInfo?.features;
  const direct = input.direct ?? (client.sendAgentMessage && (!features || supportsDurableDirectSend(features)) ? {
    serverId,
    client: { sendAgentMessage: client.sendAgentMessage.bind(client) },
    onAccepted: createDirectSendAcceptanceHandler(serverId),
  } : undefined);
  const queue = input.queue ?? (client.enqueueAgentMessage && (!features || features.agentMessageQueue === true) ? {
    serverId,
    client: {
      enqueueAgentMessage: client.enqueueAgentMessage.bind(client),
      removeQueuedAgentMessage: client.removeQueuedAgentMessage?.bind(client),
      getLastServerInfoMessage: client.getLastServerInfoMessage?.bind(client),
    },
    applySnapshot: (snapshot) => useSessionStore.getState().applyAgentQueueSnapshot(serverId, snapshot),
  } satisfies QueueOutboxServerInput : undefined);
  const activeAdmissions = () => [...admissions.values()].filter((entry) => entry.serverId === serverId);
  const agents = new Set([...directEntries(), ...queueEntries(), ...activeAdmissions()].map((entry) => entry.agentId));
  await Promise.all([...agents].filter((agentId) => input.agentId === undefined || input.agentId === agentId).map(async (agentId) => {
      for (const admission of activeAdmissions().filter((entry) => entry.agentId === agentId)) {
        if (!admission.running && admission.isPending && !(await admission.isPending())) {
          const key = admissionKey(serverId, admission.itemId);
          if (admission.running || admissions.get(key) !== admission) continue;
          admissions.delete(key);
          admission.reject(new Error("Delivery canceled or no longer pending."));
        }
      }
      if (queue) {
        for (const entry of queueEntries().filter((entry) => entry.agentId === agentId && entry.removalRequested)) {
          await flushQueueOutboxEntriesForServer({ ...queue, itemId: entry.itemId });
        }
      }
      await serializeQueueOperation(JSON.stringify(["delivery", serverId, agentId]), async () => {
      while (true) {
        const pending = [
          ...directEntries().filter((entry) => entry.agentId === agentId).map((entry) => ({ kind: "direct" as const, entry })),
          ...queueEntries().filter((entry) => entry.agentId === agentId && !entry.removalRequested && !admissions.has(admissionKey(serverId, entry.itemId))).map((entry) => ({ kind: "queue" as const, entry })),
          ...activeAdmissions().filter((entry) => entry.agentId === agentId).map((entry) => ({ kind: "admission" as const, entry })),
        ].sort((a, b) => a.entry.createdAt - b.entry.createdAt);
        const next = pending[0];
        if (!next) break;
        if (next.kind === "admission") {
          const admission = next.entry;
          const key = admissionKey(serverId, admission.itemId);
          try {
            admission.running = true;
            const result = await admission.run();
            if (admissions.get(key) === admission) admissions.delete(key);
            admission.resolve(result);
          } catch (error) {
            if (admissions.get(key) === admission) admissions.delete(key);
            admission.reject(error);
            const unresolvedDirect = directEntries().some(
              (entry) => entry.agentId === agentId && entry.clientMessageId === admission.itemId,
            );
            const unresolvedQueue = queueEntries().some(
              (entry) => entry.agentId === agentId && entry.itemId === admission.itemId,
            );
            if (unresolvedDirect || unresolvedQueue) break;
          }
        } else if (next.kind === "direct") {
          if (!direct || isUncertainSendOutcome(next.entry.rejectedError)) break;
          const id = next.entry.clientMessageId;
          if (!useSendOutboxStore.getState().entriesForServer(serverId).some((entry) => entry.clientMessageId === id)) break;
          await flushSendOutboxEntriesForServer({ ...direct, agentId, clientMessageId: id });
          if (directEntries().some((entry) => entry.clientMessageId === id)) break;
        } else {
          if (!queue) break;
          const id = next.entry.itemId;
          if (!useQueueOutboxStore.getState().entriesForServer(serverId).some((entry) => entry.itemId === id)) break;
          await flushQueueOutboxEntriesForServer({ ...queue, itemId: id });
          if (queueEntries().some((entry) => entry.itemId === id)) break;
        }
      }
      });
    }),
  );
}
