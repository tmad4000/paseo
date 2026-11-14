export interface SubmittedDraft<TAttachment> {
  readonly message: string;
  readonly attachments: readonly TAttachment[];
}

export interface FailedPreparation<TAttachment> extends SubmittedDraft<TAttachment> {
  id: string;
  scopeKey: string;
  error: string;
  isRestoring: boolean;
}

export interface PreparedDraftHold {
  fail: (error: unknown) => void;
  release: () => void;
}

export interface PreparationRecovery<TAttachment> {
  prepare: (draft: SubmittedDraft<TAttachment>) => PreparedDraftHold;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class FailedPreparationRecovery<TAttachment> {
  private entries: readonly FailedPreparation<TAttachment>[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly releases = new Map<string, () => void>();
  private readonly restoring = new Map<string, Promise<void>>();
  private nextId = 0;

  constructor(
    private readonly retainAttachments: (attachments: readonly TAttachment[]) => () => void = () =>
      () => {},
  ) {}

  getSnapshot = (): readonly FailedPreparation<TAttachment>[] => this.entries;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  forScope(scopeKey: string): PreparationRecovery<TAttachment> {
    return { prepare: (draft) => this.prepare(scopeKey, draft) };
  }

  private publish(entries: readonly FailedPreparation<TAttachment>[]): void {
    this.entries = entries;
    for (const listener of this.listeners) listener();
  }

  private prepare(scopeKey: string, draft: SubmittedDraft<TAttachment>): PreparedDraftHold {
    const snapshot = { message: draft.message, attachments: [...draft.attachments] };
    const release = this.retainAttachments(snapshot.attachments);
    let state: "held" | "failed" | "released" = "held";
    return {
      fail: (error) => {
        if (state !== "held") return;
        const duplicate = this.entries.some(
          (entry) =>
            !this.restoring.has(entry.id) &&
            entry.scopeKey === scopeKey &&
            entry.message === snapshot.message &&
            entry.attachments.length === snapshot.attachments.length &&
            entry.attachments.every(
              (attachment, index) => attachment === snapshot.attachments[index],
            ),
        );
        if (duplicate) {
          state = "released";
          release();
          return;
        }
        state = "failed";
        const id = `preparation-${++this.nextId}`;
        this.releases.set(id, release);
        this.publish([
          ...this.entries,
          { ...snapshot, id, scopeKey, error: errorMessage(error), isRestoring: false },
        ]);
      },
      release: () => {
        if (state !== "held") return;
        state = "released";
        release();
      },
    };
  }

  restore(
    id: string,
    apply: (draft: SubmittedDraft<TAttachment>) => void | Promise<void>,
  ): Promise<void> {
    const running = this.restoring.get(id);
    if (running) return running;
    const entry = this.entries.find((candidate) => candidate.id === id);
    if (!entry) return Promise.resolve();
    const operation = Promise.resolve().then(async () => {
      this.publish(
        this.entries.map((candidate) =>
          candidate.id === id ? { ...candidate, isRestoring: true } : candidate,
        ),
      );
      try {
        await apply(entry);
        this.remove(id);
      } catch (error) {
        this.publish(
          this.entries.map((candidate) =>
            candidate.id === id
              ? { ...candidate, isRestoring: false, error: errorMessage(error) }
              : candidate,
          ),
        );
        throw error;
      } finally {
        this.restoring.delete(id);
      }
    });
    this.restoring.set(id, operation);
    return operation;
  }

  discard(id: string): void {
    if (this.restoring.has(id)) return;
    this.remove(id);
  }

  private remove(id: string): void {
    this.publish(this.entries.filter((entry) => entry.id !== id));
    this.releases.get(id)?.();
    this.releases.delete(id);
  }
}

export function captureDraftPreparation<TAttachment>(
  input: SubmittedDraft<TAttachment> & {
    recovery: PreparationRecovery<TAttachment>;
    getDraftRevision: () => unknown;
  },
): { failIfChanged: (error: unknown) => void; release: () => void } {
  const held = input.recovery.prepare(input);
  const revision = input.getDraftRevision();
  return {
    failIfChanged: (error) => {
      if (input.getDraftRevision() !== revision) held.fail(error);
    },
    release: held.release,
  };
}
