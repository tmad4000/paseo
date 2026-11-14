let lastCreatedAt = 0;

export async function awaitDeliveryOrderHydration(): Promise<void> {
  const [direct, queue] = await Promise.all([
    import("@/stores/send-outbox-store"),
    import("@/stores/queue-outbox-store"),
  ]);
  await Promise.all([direct.awaitSendOutboxHydration(), queue.awaitOutboxHydration()]);
  for (const entry of [
    ...Object.values(direct.useSendOutboxStore.getState().entries),
    ...Object.values(queue.useQueueOutboxStore.getState().entries),
  ]) {
    lastCreatedAt = Math.max(lastCreatedAt, entry.createdAt);
  }
}

export function nextDeliveryCreatedAt(): number {
  lastCreatedAt = Math.max(Date.now(), lastCreatedAt + 1);
  return lastCreatedAt;
}
