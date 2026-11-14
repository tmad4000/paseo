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
import { isDefinitiveSendFailure, supportsDurableDirectSend, type PendingDirectSend, type SendOutboxFlushClient } from "@/stores/send-outbox-store/model";
import { createDirectSendAcceptanceHandler } from "@/composer/submission/direct-send-outbox";
import { useSessionStore } from "@/stores/session-store";

import { awaitDeliveryOrderHydration, nextDeliveryCreatedAt } from "@/stores/delivery-order";

export type DeliveryClient = Partial<SendOutboxFlushClient & QueueOutboxFlushClient>;
interface OrderedAdmission {
  serverId: string;
  agentId: string;
  itemId: string;
  createdAt: number;
  isPending?: () => Promise<boolean>;
  running?: boolean;
  dispatched?: boolean;
  release?: () => void;
  oneShot?: Pick<PendingDirectSend, "text" | "images" | "attachments" | "activeTurnBehavior" | "interrupt">;
  run: (markDispatched: () => void) => Promise<unknown>;
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
  client: DeliveryClient;
  isPending?: () => Promise<boolean>;
  oneShot?: OrderedAdmission["oneShot"];
  run: (markDispatched: () => void) => Promise<T>;
}): Promise<T> {
  await awaitDeliveryOrderHydration();
  const key = admissionKey(input.serverId, input.itemId);
  const prepared = await serializeQueueOperation(JSON.stringify(["admission-prepare", key]), async () => {
    const existing = admissions.get(key);
    if (existing) return { promise: existing.promise };
    let createdAt = input.createdAt;
    if (input.oneShot) {
      const store = useSendOutboxStore.getState();
      if (store.entries[input.itemId]) throw new Error("Review the saved one-time delivery before sending again.");
      try {
        await store.add({
          ...input.oneShot,
          serverId: input.serverId,
          agentId: input.agentId,
          clientMessageId: input.itemId,
          oneShot: true,
          rejectedError: "agent_request_outcome_unknown: one-time delivery awaits confirmation",
        });
      } catch (error) {
        void flushDeliveryOutboxes({ serverId: input.serverId, agentId: input.agentId, client: input.client }).catch(() => {});
        throw error;
      }
      createdAt = useSendOutboxStore.getState().entries[input.itemId]?.createdAt;
      if (createdAt === undefined) throw new Error("One-time delivery was canceled before dispatch.");
    } else if (!input.isPending) {
      throw new Error("Ordered delivery requires durable ownership.");
    }
    let resolve!: (value: unknown) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<unknown>((accept, refuse) => { resolve = accept; reject = refuse; });
    const admission: OrderedAdmission = { ...input, createdAt: createdAt ?? nextDeliveryCreatedAt(), resolve, reject, promise };
    admissions.set(key, admission);
    void flushDeliveryOutboxes({ ...input, client: input.client }).catch((error) => {
      if (admissions.get(key) === admission) {
        admissions.delete(key);
        reject(error);
      }
    });
    return { promise };
  });
  return await prepared.promise as T;
}

export function releaseOrderedAdmission(serverId: string, itemId: string): void {
  const key = admissionKey(serverId, itemId);
  const admission = admissions.get(key);
  if (!admission) return;
  if (admission.release) admission.release();
  else if (!admission.running) {
    admissions.delete(key);
    admission.reject(new Error("One-time delivery hold was released."));
  }
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
      (entry.oneShot || entry.rejectedError === undefined || isUncertainSendOutcome(entry.rejectedError)),
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
          ...directEntries().filter((entry) => entry.agentId === agentId && !admissions.has(admissionKey(serverId, entry.clientMessageId))).map((entry) => ({ kind: "direct" as const, entry })),
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
            if (admission.oneShot && !useSendOutboxStore.getState().entries[admission.itemId]) {
              throw new Error("One-time delivery was canceled before dispatch.");
            }
            const released = new Promise<never>((_resolve, rejectRelease) => {
              admission.release = () => rejectRelease(new Error("One-time delivery hold was released."));
            });
            const running = admission.run(() => {
              if (admission.oneShot && !useSendOutboxStore.getState().entries[admission.itemId]) {
                throw new Error("One-time delivery was canceled before dispatch.");
              }
              admission.dispatched = true;
            });
            const result = await Promise.race([running, released]);
            admission.release = undefined;
            if (admission.oneShot) await useSendOutboxStore.getState().removeDurably(admission.itemId);
            if (admissions.get(key) === admission) admissions.delete(key);
            admission.resolve(result);
          } catch (error) {
            admission.release = undefined;
            if (admissions.get(key) === admission) admissions.delete(key);
            let reported = error;
            const cause = error instanceof Error && error.cause ? error.cause : error;
            const causeMessage = cause instanceof Error ? cause.message : String(cause);
            if (admission.oneShot && (!admission.dispatched || (isDefinitiveSendFailure(cause) && !isUncertainSendOutcome(causeMessage)))) {
              try {
                await useSendOutboxStore.getState().removeDurably(admission.itemId);
              } catch (storageError) {
                reported = storageError;
              }
            }
            admission.reject(reported);
            const unresolvedDirect = directEntries().some(
              (entry) => entry.agentId === agentId && entry.clientMessageId === admission.itemId,
            );
            const unresolvedQueue = queueEntries().some(
              (entry) => entry.agentId === agentId && entry.itemId === admission.itemId,
            );
            if (unresolvedDirect || unresolvedQueue) break;
          }
        } else if (next.kind === "direct") {
          if (!direct || next.entry.oneShot || isUncertainSendOutcome(next.entry.rejectedError)) break;
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
