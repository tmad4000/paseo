let lastCreatedAt = 0;

export function nextDeliveryCreatedAt(): number {
  lastCreatedAt = Math.max(Date.now(), lastCreatedAt + 1);
  return lastCreatedAt;
}
