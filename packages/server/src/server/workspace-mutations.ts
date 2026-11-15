const mutationTails = new WeakMap<object, Promise<void>>();

export function runWorkspaceMutation<T>(owner: object, operation: () => Promise<T>): Promise<T> {
  const previous = mutationTails.get(owner) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(operation);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  mutationTails.set(owner, tail);
  void tail.then(() => {
    if (mutationTails.get(owner) === tail) mutationTails.delete(owner);
    return undefined;
  });
  return result;
}

// Queued moves live only within this registry's daemon lifetime. Share their preparation
// fence across sessions without persisting a failed setup as an archived workspace.
const preparationRevisions = new WeakMap<object, Map<string, number>>();

export function getWorkspacePreparationRevision(owner: object, workspaceId: string): number {
  return preparationRevisions.get(owner)?.get(workspaceId) ?? 0;
}

export function invalidateWorkspacePreparation(owner: object, workspaceId: string): Promise<void> {
  return runWorkspaceMutation(owner, async () => {
    let revisions = preparationRevisions.get(owner);
    if (!revisions) {
      revisions = new Map();
      preparationRevisions.set(owner, revisions);
    }
    revisions.set(workspaceId, getWorkspacePreparationRevision(owner, workspaceId) + 1);
  });
}
