interface ArtifactPinInput {
  agentId: string;
  entryId: string;
  action: "add_pin";
  text: string;
  sourceId: string;
}

export class ArtifactPinOperations {
  private readonly ids = new Map<string, string>();
  private readonly pending = new Map<string, Promise<void>>();

  save(
    serverId: string,
    agentId: string,
    path: string,
    write: (input: ArtifactPinInput) => Promise<unknown>,
  ): Promise<void> {
    const key = JSON.stringify([serverId, agentId, path]);
    const pending = this.pending.get(key);
    if (pending) return pending;
    const entryId = this.ids.get(key) ?? globalThis.crypto.randomUUID();
    this.ids.set(key, entryId);
    const operation = Promise.resolve()
      .then(() =>
        write({
          agentId,
          entryId,
          action: "add_pin",
          text: `Artifact: ${path}`,
          sourceId: `artifact:${path}`,
        }),
      )
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
