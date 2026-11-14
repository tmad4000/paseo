import { awaitSendOutboxHydration, useSendOutboxStore } from "@/stores/send-outbox-store";
import { awaitOutboxHydration, useQueueOutboxStore } from "@/stores/queue-outbox-store";

let lastCreatedAt = 0;

export async function awaitDeliveryOrderHydration(): Promise<void> {
  await Promise.all([awaitSendOutboxHydration(), awaitOutboxHydration()]);
  for (const entry of [
    ...Object.values(useSendOutboxStore.getState().entries),
    ...Object.values(useQueueOutboxStore.getState().entries),
  ]) {
    lastCreatedAt = Math.max(lastCreatedAt, entry.createdAt);
  }
}

export function nextDeliveryCreatedAt(): number {
  lastCreatedAt = Math.max(Date.now(), lastCreatedAt + 1);
  return lastCreatedAt;
}
