import type { ResolvedUiCommand } from "./resolve";

/**
 * The push router runs outside React and can receive a command before the app
 * shell (and therefore the router) is mounted. Commands land here and the
 * listener drains them once it is alive, so an early command is deferred
 * rather than dropped.
 */

const pending: ResolvedUiCommand[] = [];
const listeners = new Set<() => void>();

export function enqueueUiCommand(command: ResolvedUiCommand): void {
  pending.push(command);
  // Snapshot: a listener may unsubscribe while draining.
  for (const listener of Array.from(listeners)) {
    listener();
  }
}

export function drainUiCommands(): ResolvedUiCommand[] {
  return pending.splice(0, pending.length);
}

export function subscribeToUiCommands(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam: forget anything queued but never drained. */
export function resetUiCommandQueue(): void {
  pending.length = 0;
  listeners.clear();
}
