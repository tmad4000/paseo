interface PendingOutboxWrite<Entry> {
  entry: Entry;
  settled: Promise<void>;
}

export function createOutboxWriteTracker<Entry>() {
  const writes = new Map<string, PendingOutboxWrite<Entry>>();
  return {
    retain: (id: string, entry: Entry) => {
      let settle!: () => void;
      const settled = new Promise<void>((resolve) => {
        settle = resolve;
      });
      const write = { entry, settled };
      writes.set(id, write);
      return () => {
        if (writes.get(id) === write) writes.delete(id);
        settle();
      };
    },
    has: (id: string) => writes.has(id),
    pending: (id: string) => writes.get(id)?.settled,
    entries: (current: Record<string, Entry>): Entry[] => {
      const owned = { ...current };
      for (const [id, write] of writes) owned[id] = write.entry;
      return Object.values(owned);
    },
  };
}
