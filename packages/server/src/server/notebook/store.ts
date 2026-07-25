import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  StoredWorkNotebookSchema,
  type NotebookAppendEntry,
  type NotebookEvent,
  type NotebookEventAuthor,
  type StoredWorkNotebook,
  type WorkNotebook,
} from "@getpaseo/protocol/notebook/types";
import { projectNotebookEvents } from "@getpaseo/protocol/notebook/projections";
import { writeJsonFileAtomic } from "../atomic-file.js";
import type { DerivedNotebookSources } from "./derived-sources.js";

const DEFAULT_PAGE_LIMIT = 200;

export interface WorkNotebookPage {
  notebook: WorkNotebook;
  events: NotebookEvent[];
  hasMore: boolean;
}

export interface WorkNotebookAppendResult {
  notebook: WorkNotebook;
  event: NotebookEvent;
}

export interface WorkNotebookStoreDependencies {
  now(): Date;
  createId(): string;
}

export class WorkNotebookRevisionConflictError extends Error {
  constructor(readonly currentRevision: number) {
    super(`Notebook revision is ${currentRevision}`);
    this.name = "WorkNotebookRevisionConflictError";
  }
}

export class WorkNotebookInvalidTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkNotebookInvalidTargetError";
  }
}

const defaultDependencies: WorkNotebookStoreDependencies = {
  now: () => new Date(),
  createId: () => randomUUID(),
};

export class WorkNotebookStore {
  private readonly mutations = new Map<string, Promise<unknown>>();

  constructor(
    private readonly directory: string,
    private readonly dependencies: WorkNotebookStoreDependencies = defaultDependencies,
  ) {}

  async ensureSessionNotebook(agentId: string): Promise<WorkNotebook> {
    return this.serialize(agentId, async () => {
      const stored = await this.read(agentId);
      if (stored) {
        return stored.notebook;
      }
      const created = this.create(agentId);
      await this.write(agentId, created);
      return created.notebook;
    });
  }

  async getSessionNotebookPage(input: {
    agentId: string;
    afterSequence?: number;
    limit?: number;
  }): Promise<WorkNotebookPage> {
    return this.serialize(input.agentId, async () => {
      const stored = (await this.read(input.agentId)) ?? this.create(input.agentId);
      if (stored.notebook.revision === 0 && stored.events.length === 0) {
        await this.write(input.agentId, stored);
      }
      const afterSequence = input.afterSequence ?? 0;
      const limit = input.limit ?? DEFAULT_PAGE_LIMIT;
      const remaining = stored.events.filter((event) => event.sequence > afterSequence);
      return {
        notebook: stored.notebook,
        events: remaining.slice(0, limit),
        hasMore: remaining.length > limit,
      };
    });
  }

  async append(input: {
    agentId: string;
    expectedRevision: number;
    author: NotebookEventAuthor;
    entry: NotebookAppendEntry;
  }): Promise<WorkNotebookAppendResult> {
    return this.serialize(input.agentId, async () => {
      const current = (await this.read(input.agentId)) ?? this.create(input.agentId);
      if (current.notebook.revision !== input.expectedRevision) {
        throw new WorkNotebookRevisionConflictError(current.notebook.revision);
      }
      validateEntryTarget(current.events, input.entry);

      const createdAt = this.dependencies.now().toISOString();
      const sequence = current.notebook.lastSequence + 1;
      const event = createNotebookEvent({
        entry: input.entry,
        notebookId: current.notebook.id,
        id: this.dependencies.createId(),
        sequence,
        createdAt,
        author: input.author,
      });
      const notebook: WorkNotebook = {
        ...current.notebook,
        updatedAt: createdAt,
        revision: current.notebook.revision + 1,
        lastSequence: sequence,
      };
      await this.write(input.agentId, {
        notebook,
        events: [...current.events, event],
      });
      return { notebook, event };
    });
  }

  async reconcileDerivedSources(input: {
    agentId: string;
    sources: DerivedNotebookSources;
  }): Promise<WorkNotebook> {
    return this.serialize(input.agentId, async () => {
      const current = (await this.read(input.agentId)) ?? this.create(input.agentId);
      const existingIds = new Set(current.events.map((event) => event.id));
      const appended: NotebookEvent[] = [];
      let notebook = current.notebook;

      const appendDerivedEvent = (
        sourceKey: string,
        create: (envelope: {
          id: string;
          notebookId: string;
          sequence: number;
          createdAt: string;
          author: { kind: "system" };
        }) => NotebookEvent,
      ) => {
        const id = buildDerivedEventId(current.notebook.id, sourceKey);
        if (existingIds.has(id)) {
          return;
        }
        const createdAt = this.dependencies.now().toISOString();
        const sequence = notebook.lastSequence + 1;
        const event = create({
          id,
          notebookId: current.notebook.id,
          sequence,
          createdAt,
          author: { kind: "system" },
        });
        appended.push(event);
        existingIds.add(id);
        notebook = {
          ...notebook,
          updatedAt: createdAt,
          revision: notebook.revision + 1,
          lastSequence: sequence,
        };
      };

      for (const link of input.sources.links) {
        appendDerivedEvent(`link:${link.url}`, (envelope) => ({
          ...envelope,
          kind: "link_captured",
          url: link.url,
          source: link.source,
        }));
      }
      for (const artifact of input.sources.artifacts) {
        appendDerivedEvent(
          `artifact:${artifact.path}:${artifact.updatedAt}:${artifact.size}`,
          (envelope) => ({
            ...envelope,
            kind: "artifact_observed",
            artifact,
            source: { agentId: input.agentId },
          }),
        );
      }

      if (appended.length > 0) {
        await this.write(input.agentId, {
          notebook,
          events: [...current.events, ...appended],
        });
      }
      return notebook;
    });
  }

  private create(agentId: string): StoredWorkNotebook {
    const timestamp = this.dependencies.now().toISOString();
    return {
      notebook: {
        id: buildSessionNotebookId(agentId),
        agentId,
        scope: "session",
        createdAt: timestamp,
        updatedAt: timestamp,
        revision: 0,
        lastSequence: 0,
      },
      events: [],
    };
  }

  private async read(agentId: string): Promise<StoredWorkNotebook | null> {
    try {
      const content = await readFile(this.filePath(agentId), "utf8");
      return StoredWorkNotebookSchema.parse(JSON.parse(content));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  private async write(agentId: string, notebook: StoredWorkNotebook): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await writeJsonFileAtomic(this.filePath(agentId), StoredWorkNotebookSchema.parse(notebook));
  }

  private filePath(agentId: string): string {
    const key = createHash("sha256").update(agentId).digest("hex");
    return join(this.directory, `${key}.json`);
  }

  private async serialize<T>(agentId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.mutations.get(agentId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.mutations.set(agentId, next);
    try {
      return await next;
    } finally {
      if (this.mutations.get(agentId) === next) {
        this.mutations.delete(agentId);
      }
    }
  }
}

function buildSessionNotebookId(agentId: string): string {
  const digest = createHash("sha256").update(`session:${agentId}`).digest("hex").slice(0, 24);
  return `notebook_${digest}`;
}

function buildDerivedEventId(notebookId: string, sourceKey: string): string {
  const digest = createHash("sha256")
    .update(`${notebookId}:${sourceKey}`)
    .digest("hex")
    .slice(0, 24);
  return `derived_${digest}`;
}

function validateEntryTarget(events: readonly NotebookEvent[], entry: NotebookAppendEntry): void {
  if (entry.kind === "note_added" || entry.kind === "question_opened") {
    return;
  }

  const target = events.find((event) => event.id === entry.targetEventId);
  if (!target) {
    throw new WorkNotebookInvalidTargetError("Notebook item not found");
  }

  const projections = projectNotebookEvents(events);
  if (entry.kind === "question_resolved" || entry.kind === "question_reopened") {
    if (target.kind !== "question_opened") {
      throw new WorkNotebookInvalidTargetError("Question state can only target a question");
    }
    const isOpen = projections.openQuestions.some((question) => question.id === target.id);
    if (entry.kind === "question_resolved" && !isOpen) {
      throw new WorkNotebookInvalidTargetError("Question is already resolved");
    }
    if (entry.kind === "question_reopened" && isOpen) {
      throw new WorkNotebookInvalidTargetError("Question is already open");
    }
    return;
  }

  const isPinned = projections.pinnedItems.some((item) => item.id === target.id);
  if (entry.kind === "item_pinned" && isPinned) {
    throw new WorkNotebookInvalidTargetError("Notebook item is already pinned");
  }
  if (entry.kind === "item_unpinned" && !isPinned) {
    throw new WorkNotebookInvalidTargetError("Notebook item is not pinned");
  }
}

interface CreateNotebookEventInput {
  entry: NotebookAppendEntry;
  notebookId: string;
  id: string;
  sequence: number;
  createdAt: string;
  author: NotebookEventAuthor;
}

function createNotebookEvent(input: CreateNotebookEventInput): NotebookEvent {
  const envelope = {
    id: input.id,
    notebookId: input.notebookId,
    sequence: input.sequence,
    createdAt: input.createdAt,
    author: input.author,
  };
  switch (input.entry.kind) {
    case "note_added":
      return { ...envelope, kind: input.entry.kind, markdown: input.entry.markdown };
    case "question_opened":
      return { ...envelope, kind: input.entry.kind, markdown: input.entry.markdown };
    case "question_resolved":
      return { ...envelope, kind: input.entry.kind, targetEventId: input.entry.targetEventId };
    case "question_reopened":
      return { ...envelope, kind: input.entry.kind, targetEventId: input.entry.targetEventId };
    case "item_pinned":
      return { ...envelope, kind: input.entry.kind, targetEventId: input.entry.targetEventId };
    case "item_unpinned":
      return { ...envelope, kind: input.entry.kind, targetEventId: input.entry.targetEventId };
  }
}
