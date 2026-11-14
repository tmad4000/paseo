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
