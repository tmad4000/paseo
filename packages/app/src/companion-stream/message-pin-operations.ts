interface MessagePinInput {
  agentId: string;
  entryId: string;
  action: "add_pin";
  text: string;
  sourceId?: string;
}

/** Keep the same durable identity when a save succeeded but its acknowledgement was lost. */
export class MessagePinOperations {
  private readonly ids = new Map<string, string>();
  private readonly pending = new Map<string, Promise<void>>();

  save(
    serverId: string,
    agentId: string,
    text: string,
    sourceId: string | undefined,
    write: (input: MessagePinInput) => Promise<unknown>,
  ): Promise<void> {
    const key = JSON.stringify([serverId, agentId, sourceId, text]);
    const pending = this.pending.get(key);
    if (pending) return pending;
    const entryId = this.ids.get(key) ?? globalThis.crypto.randomUUID();
    this.ids.set(key, entryId);
    const operation = Promise.resolve()
      .then(() => write({ agentId, entryId, action: "add_pin", text, sourceId }))
      .then(() => {
        this.ids.delete(key);
        return;
      })
      .finally(() => {
        this.pending.delete(key);
      });
    this.pending.set(key, operation);
    return operation;
  }
}

export type MessagePinHandler = (text: string, sourceId?: string) => Promise<void>;

export function messagePinErrorMessage(cause: unknown, fallback: string): string {
  if (!(cause instanceof Error)) return fallback;
  const { requestType, code } = cause as Error & { requestType?: string; code?: string };
  return (
    cause.message.replace(` requestType=${requestType}`, "").replace(` code=${code}`, "").trim() ||
    fallback
  );
}
