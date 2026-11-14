import {
  awaitSendOutboxHydration,
  pendingSendOutboxWrite,
  sendOutboxDeliveryEntries,
  flushSendOutboxEntriesForServer,
  isUncertainSendOutcome,
  useSendOutboxStore,
  type SendOutboxServerInput,
} from "@/stores/send-outbox-store";
import {
  awaitOutboxHydration,
  pendingQueueOutboxWrite,
  queueOutboxDeliveryEntries,
  flushQueueOutboxEntriesForServer,
  useQueueOutboxStore,
  type QueueOutboxServerInput,
  type PendingQueueEnqueue,
} from "@/stores/queue-outbox-store";
import {
  serializeQueueOperation,
  type QueueOutboxFlushClient,
} from "@/stores/queue-outbox-store/model";
import {
  isDefinitiveSendFailure,
  supportsDurableDirectSend,
  type PendingDirectSend,
  type SendOutboxFlushClient,
} from "@/stores/send-outbox-store/model";
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
  oneShot?: Pick<
    PendingDirectSend,
    "text" | "images" | "attachments" | "activeTurnBehavior" | "interrupt"
  >;
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
  const prepared = await serializeQueueOperation(
    JSON.stringify(["admission-prepare", key]),
    async () => {
      const existing = admissions.get(key);
      if (existing) return { promise: existing.promise };
      let createdAt = input.createdAt;
      if (input.oneShot) {
        const store = useSendOutboxStore.getState();
        if (store.entries[input.itemId])
          throw new Error("Review the saved one-time delivery before sending again.");
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
          void flushDeliveryOutboxes({
            serverId: input.serverId,
            agentId: input.agentId,
            client: input.client,
          }).catch(() => {});
          throw error;
        }
        createdAt = useSendOutboxStore.getState().entries[input.itemId]?.createdAt;
        if (createdAt === undefined)
          throw new Error("One-time delivery was canceled before dispatch.");
      } else if (!input.isPending) {
        throw new Error("Ordered delivery requires durable ownership.");
      }
      let resolve!: (value: unknown) => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<unknown>((accept, refuse) => {
        resolve = accept;
        reject = refuse;
      });
      const admission: OrderedAdmission = {
        ...input,
        createdAt: createdAt ?? nextDeliveryCreatedAt(),
        resolve,
        reject,
        promise,
      };
      admissions.set(key, admission);
      void flushDeliveryOutboxes({ ...input, client: input.client }).catch((error) => {
        if (admissions.get(key) === admission) {
          admissions.delete(key);
          reject(error);
        }
      });
      return { promise };
    },
  );
  return (await prepared.promise) as T;
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

interface DeliveryFlushInput {
  serverId: string;
  agentId?: string;
  client: DeliveryClient;
  direct?: SendOutboxServerInput;
  queue?: QueueOutboxServerInput;
}

interface DeliveryDrivers {
  direct?: SendOutboxServerInput;
  queue?: QueueOutboxServerInput;
}

type DeliveryCandidate =
  | { kind: "direct"; entry: PendingDirectSend }
  | { kind: "queue"; entry: PendingQueueEnqueue }
  | { kind: "admission"; entry: OrderedAdmission };

function directEntries(serverId: string): PendingDirectSend[] {
  return sendOutboxDeliveryEntries().filter(
    (saved) =>
      saved.serverId === serverId &&
      (saved.oneShot ||
        saved.rejectedError === undefined ||
        isUncertainSendOutcome(saved.rejectedError)),
  );
}

function queueEntries(serverId: string): PendingQueueEnqueue[] {
  return queueOutboxDeliveryEntries().filter(
    (saved) => saved.serverId === serverId,
  );
}

function activeAdmissions(serverId: string): OrderedAdmission[] {
  return [...admissions.values()].filter((saved) => saved.serverId === serverId);
}

function resolveDirectDriver(input: DeliveryFlushInput): SendOutboxServerInput | undefined {
  if (input.direct) return input.direct;
  const { client, serverId } = input;
  const features =
    client.getLastServerInfoMessage?.()?.features ??
    useSessionStore.getState().sessions[serverId]?.serverInfo?.features;
  if (!client.sendAgentMessage || (features && !supportsDurableDirectSend(features)))
    return undefined;
  return {
    serverId,
    client: { sendAgentMessage: client.sendAgentMessage.bind(client) },
    onAccepted: createDirectSendAcceptanceHandler(serverId),
  };
}

function resolveQueueDriver(input: DeliveryFlushInput): QueueOutboxServerInput | undefined {
  if (input.queue) return input.queue;
  const { client, serverId } = input;
  const features =
    client.getLastServerInfoMessage?.()?.features ??
    useSessionStore.getState().sessions[serverId]?.serverInfo?.features;
  if (!client.enqueueAgentMessage || (features && features.agentMessageQueue !== true))
    return undefined;
  return {
    serverId,
    client: {
      enqueueAgentMessage: client.enqueueAgentMessage.bind(client),
      removeQueuedAgentMessage: client.removeQueuedAgentMessage?.bind(client),
      getLastServerInfoMessage: client.getLastServerInfoMessage?.bind(client),
    },
    applySnapshot: (snapshot) =>
      useSessionStore.getState().applyAgentQueueSnapshot(serverId, snapshot),
  };
}

function detachAdmission(admission: OrderedAdmission): void {
  const key = admissionKey(admission.serverId, admission.itemId);
  if (admissions.get(key) === admission) admissions.delete(key);
}

async function rejectCanceledAdmissions(serverId: string, agentId: string): Promise<void> {
  for (const admission of activeAdmissions(serverId).filter((saved) => saved.agentId === agentId)) {
    if (admission.running || !admission.isPending || (await admission.isPending())) continue;
    if (admission.running || admissions.get(admissionKey(serverId, admission.itemId)) !== admission)
      continue;
    detachAdmission(admission);
    admission.reject(new Error("Delivery canceled or no longer pending."));
  }
}

async function flushRemovalIntents(
  serverId: string,
  agentId: string,
  driver?: QueueOutboxServerInput,
): Promise<void> {
  if (!driver) return;
  const removals = queueEntries(serverId).filter(
    (saved) => saved.agentId === agentId && saved.removalRequested,
  );
  for (const removal of removals)
    await flushQueueOutboxEntriesForServer({ ...driver, itemId: removal.itemId });
}

function nextDelivery(serverId: string, agentId: string): DeliveryCandidate | undefined {
  const pending: DeliveryCandidate[] = [
    ...directEntries(serverId)
      .filter(
        (saved) =>
          saved.agentId === agentId &&
          !admissions.has(admissionKey(serverId, saved.clientMessageId)),
      )
      .map((entry) => ({ kind: "direct" as const, entry })),
    ...queueEntries(serverId)
      .filter(
        (saved) =>
          saved.agentId === agentId &&
          !saved.removalRequested &&
          !admissions.has(admissionKey(serverId, saved.itemId)),
      )
      .map((entry) => ({ kind: "queue" as const, entry })),
    ...activeAdmissions(serverId)
      .filter((saved) => saved.agentId === agentId)
      .map((entry) => ({ kind: "admission" as const, entry })),
  ];
  pending.sort((left, right) => left.entry.createdAt - right.entry.createdAt);
  return pending[0];
}

function ensureOneShotOwnership(admission: OrderedAdmission): void {
  if (
    admission.oneShot &&
    !sendOutboxDeliveryEntries().some((saved) => saved.clientMessageId === admission.itemId)
  ) {
    throw new Error("One-time delivery was canceled before dispatch.");
  }
}

function canReleaseFailedOneShot(admission: OrderedAdmission, error: unknown): boolean {
  if (!admission.oneShot) return false;
  if (!admission.dispatched) return true;
  const cause = error instanceof Error && error.cause ? error.cause : error;
  const message = cause instanceof Error ? cause.message : String(cause);
  return isDefinitiveSendFailure(cause) && !isUncertainSendOutcome(message);
}

function hasUnresolvedBarrier(admission: OrderedAdmission): boolean {
  return (
    directEntries(admission.serverId).some(
      (saved) => saved.agentId === admission.agentId && saved.clientMessageId === admission.itemId,
    ) ||
    queueEntries(admission.serverId).some(
      (saved) => saved.agentId === admission.agentId && saved.itemId === admission.itemId,
    )
  );
}

async function rejectFailedAdmission(
  admission: OrderedAdmission,
  error: unknown,
): Promise<boolean> {
  admission.release = undefined;
  detachAdmission(admission);
  let reported = error;
  if (canReleaseFailedOneShot(admission, error)) {
    try {
      await useSendOutboxStore.getState().removeDurably(admission.itemId);
    } catch (storageError) {
      reported = storageError;
    }
  }
  admission.reject(reported);
  return !hasUnresolvedBarrier(admission);
}

async function dispatchAdmission(admission: OrderedAdmission): Promise<boolean> {
  try {
    admission.running = true;
    ensureOneShotOwnership(admission);
    const released = new Promise<never>((_resolve, rejectRelease) => {
      admission.release = () => rejectRelease(new Error("One-time delivery hold was released."));
    });
    const running = admission.run(() => {
      ensureOneShotOwnership(admission);
      admission.dispatched = true;
    });
    const result = await Promise.race([running, released]);
    admission.release = undefined;
    if (admission.oneShot) await useSendOutboxStore.getState().removeDurably(admission.itemId);
    detachAdmission(admission);
    admission.resolve(result);
    return true;
  } catch (error) {
    return rejectFailedAdmission(admission, error);
  }
}

async function dispatchDirect(
  entry: PendingDirectSend,
  driver?: SendOutboxServerInput,
): Promise<boolean> {
  if (!driver || entry.oneShot || isUncertainSendOutcome(entry.rejectedError)) return false;
  const eligible = useSendOutboxStore.getState().entriesForServer(entry.serverId);
  if (!eligible.some((saved) => saved.clientMessageId === entry.clientMessageId)) return false;
  await flushSendOutboxEntriesForServer({
    ...driver,
    agentId: entry.agentId,
    clientMessageId: entry.clientMessageId,
  });
  return !directEntries(entry.serverId).some(
    (saved) => saved.clientMessageId === entry.clientMessageId,
  );
}

async function dispatchQueue(
  entry: PendingQueueEnqueue,
  driver?: QueueOutboxServerInput,
): Promise<boolean> {
  if (!driver) return false;
  const eligible = useQueueOutboxStore.getState().entriesForServer(entry.serverId);
  if (!eligible.some((saved) => saved.itemId === entry.itemId)) return false;
  await flushQueueOutboxEntriesForServer({ ...driver, itemId: entry.itemId });
  return !queueEntries(entry.serverId).some((saved) => saved.itemId === entry.itemId);
}

function dispatchNext(candidate: DeliveryCandidate, drivers: DeliveryDrivers): Promise<boolean> {
  switch (candidate.kind) {
    case "admission":
      return dispatchAdmission(candidate.entry);
    case "direct":
      return dispatchDirect(candidate.entry, drivers.direct);
    case "queue":
      return dispatchQueue(candidate.entry, drivers.queue);
  }
}

function pendingDeliveryWrite(candidate: DeliveryCandidate): Promise<void> | undefined {
  if (candidate.kind === "direct")
    return pendingSendOutboxWrite(candidate.entry.clientMessageId);
  if (candidate.kind === "admission" && candidate.entry.oneShot)
    return pendingSendOutboxWrite(candidate.entry.itemId);
  return pendingQueueOutboxWrite(candidate.entry.itemId);
}

async function flushAgentDelivery(
  input: DeliveryFlushInput,
  agentId: string,
  drivers: DeliveryDrivers,
): Promise<void> {
  const { serverId } = input;
  await rejectCanceledAdmissions(serverId, agentId);
  await flushRemovalIntents(serverId, agentId, drivers.queue);
  await serializeQueueOperation(JSON.stringify(["delivery", serverId, agentId]), async () => {
    while (true) {
      const candidate = nextDelivery(serverId, agentId);
      if (!candidate) return;
      const writing = pendingDeliveryWrite(candidate);
      if (writing) {
        void writing
          .then(() => flushDeliveryOutboxes({ ...input, agentId }))
          .catch(() => {});
        return;
      }
      if (!(await dispatchNext(candidate, drivers))) return;
    }
  });
}

export async function flushDeliveryOutboxes(input: DeliveryFlushInput): Promise<void> {
  await Promise.all([awaitSendOutboxHydration(), awaitOutboxHydration()]);
  const drivers = { direct: resolveDirectDriver(input), queue: resolveQueueDriver(input) };
  const agents = new Set(
    [
      ...directEntries(input.serverId),
      ...queueEntries(input.serverId),
      ...activeAdmissions(input.serverId),
    ].map((saved) => saved.agentId),
  );
  await Promise.all(
    [...agents]
      .filter((agentId) => input.agentId === undefined || input.agentId === agentId)
      .map((agentId) => flushAgentDelivery(input, agentId, drivers)),
  );
}
