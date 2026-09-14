import { randomUUID } from "node:crypto";
import type { Logger } from "pino";

import type {
  AgentAttachment,
  AgentQueueSnapshot,
  QueuedComposerAttachment,
} from "@getpaseo/protocol/messages";
import type { AgentLifecycleStatus } from "@getpaseo/protocol/agent-lifecycle";

import type { AgentManager } from "../agent/agent-manager.js";
import type { AgentPromptInput } from "../agent/agent-sdk-types.js";
import type { AgentStorage } from "../agent/agent-storage.js";
import { buildAgentPrompt } from "../agent/prompt-attachments.js";
import { sendPromptToAgent } from "../agent/agent-prompt.js";
import {
  recordDrainedId,
  toAgentQueueSnapshot,
  type AgentQueueMutationResult,
  type AgentQueueStore,
  type StoredQueuedImage,
  type StoredQueuedMessage,
} from "./store.js";

export type AgentQueueMutationListener = (snapshot: AgentQueueSnapshot) => void;

export interface EnqueueAgentMessageInput {
  agentId: string;
  itemId: string;
  text: string;
  images?: Array<{ data: string; mimeType: string }>;
  attachments?: AgentAttachment[];
  composerAttachments?: QueuedComposerAttachment[];
}

export interface SendQueuedPromptInput {
  agentId: string;
  prompt: AgentPromptInput;
  messageId: string;
}

export interface AgentQueueServiceOptions {
  store: AgentQueueStore;
  agentManager: AgentQueueAgentController;
  agentStorage: AgentStorage;
  logger: Logger;
  /**
   * Injected so tests can substitute the send without module mocks; defaults to
   * the same sendPromptToAgent the send_agent_message_request handler uses.
   */
  sendPrompt?: (input: SendQueuedPromptInput) => Promise<unknown>;
}

export type AgentQueueAgentController = Pick<AgentManager, "subscribe" | "getAgent">;

/**
 * Owns the per-agent message queue for the whole daemon: one instance, shared by
 * every connected session, so the queue mirrors across devices and drains even
 * when nothing is connected. See docs/queue-mirroring.md.
 */
export class AgentQueueService {
  private readonly store: AgentQueueStore;
  private readonly agentManager: AgentQueueAgentController;
  private readonly agentStorage: AgentStorage;
  private readonly logger: Logger;
  private readonly sendPrompt: (input: SendQueuedPromptInput) => Promise<unknown>;

  private readonly listeners = new Set<AgentQueueMutationListener>();
  private readonly lastLifecycle = new Map<string, AgentLifecycleStatus>();
  private readonly drainTails = new Map<string, Promise<void>>();
  private unsubscribeAgentEvents: (() => void) | null = null;

  constructor(options: AgentQueueServiceOptions) {
    this.store = options.store;
    this.agentManager = options.agentManager;
    this.agentStorage = options.agentStorage;
    this.logger = options.logger.child({ module: "agent", component: "agent-queue" });
    this.sendPrompt =
      options.sendPrompt ??
      ((input) =>
        sendPromptToAgent({
          agentManager: this.agentManager as AgentManager,
          agentStorage: this.agentStorage,
          agentId: input.agentId,
          prompt: input.prompt,
          messageId: input.messageId,
          logger: this.logger,
        }));
  }

  start(): void {
    if (this.unsubscribeAgentEvents) {
      return;
    }
    this.unsubscribeAgentEvents = this.agentManager.subscribe((event) => {
      if (event.type !== "agent_state") {
        return;
      }
      this.handleAgentState(event.agent.id, event.agent.lifecycle);
    });
  }

  stop(): void {
    this.unsubscribeAgentEvents?.();
    this.unsubscribeAgentEvents = null;
    this.listeners.clear();
    this.lastLifecycle.clear();
  }

  subscribeToMutations(listener: AgentQueueMutationListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async list(agentId: string): Promise<AgentQueueSnapshot> {
    return toAgentQueueSnapshot(await this.store.get(agentId));
  }

  async enqueue(input: EnqueueAgentMessageInput): Promise<AgentQueueSnapshot> {
    const text = input.text.trim();
    const attachments = input.attachments ?? [];
    const images = input.images ?? [];
    if (!text && attachments.length === 0 && images.length === 0) {
      throw new Error("Cannot queue an empty message");
    }

    const item: StoredQueuedMessage = {
      id: input.itemId,
      text,
      createdAt: new Date().toISOString(),
      ...(attachments.length ? { attachments } : {}),
      ...(input.composerAttachments?.length
        ? { composerAttachments: input.composerAttachments }
        : {}),
      ...(images.length
        ? {
            images: images.map((image) => ({
              id: randomUUID(),
              mimeType: image.mimeType,
              fileName: null,
              data: image.data,
            })),
          }
        : {}),
    };

    const result = await this.store.mutate(input.agentId, (current) =>
      // Re-enqueueing the same id is a retry, not a duplicate — including a
      // retry that lands after the item was already drained and delivered.
      current.items.some((existing) => existing.id === item.id) ||
      current.drainedIds?.includes(item.id)
        ? current
        : { ...current, items: [...current.items, item] },
    );
    this.publish(result);
    this.scheduleDrain(input.agentId);
    return toAgentQueueSnapshot(result.queue);
  }

  async remove(agentId: string, itemId: string): Promise<AgentQueueSnapshot> {
    const result = await this.store.mutate(agentId, (current) =>
      current.items.some((item) => item.id === itemId)
        ? { ...current, items: current.items.filter((item) => item.id !== itemId) }
        : current,
    );
    this.publish(result);
    return toAgentQueueSnapshot(result.queue);
  }

  async reorder(agentId: string, itemIds: string[]): Promise<AgentQueueSnapshot> {
    const result = await this.store.mutate(agentId, (current) => {
      const byId = new Map(current.items.map((item) => [item.id, item]));
      const ordered: StoredQueuedMessage[] = [];
      for (const id of itemIds) {
        const item = byId.get(id);
        if (item) {
          ordered.push(item);
          byId.delete(id);
        }
      }
      // Ids the caller did not mention keep their relative order at the end.
      ordered.push(...current.items.filter((item) => byId.has(item.id)));
      const unchanged = ordered.every((item, index) => current.items[index]?.id === item.id);
      return unchanged ? current : { ...current, items: ordered };
    });
    this.publish(result);
    return toAgentQueueSnapshot(result.queue);
  }

  /**
   * Returns the stored image bytes for one queued item. Only the device that
   * queued an image has a local copy, so any other device has to ask for it
   * before it can pull the item back into its composer.
   */
  async getItemImages(agentId: string, itemId: string): Promise<StoredQueuedImage[]> {
    const queue = await this.store.get(agentId);
    const item = queue.items.find((candidate) => candidate.id === itemId);
    if (!item) {
      throw new Error(`Queued message ${itemId} is no longer queued`);
    }
    return item.images ?? [];
  }

  async deleteForAgent(agentId: string): Promise<void> {
    await this.store.delete(agentId);
    this.lastLifecycle.delete(agentId);
  }

  private handleAgentState(agentId: string, lifecycle: AgentLifecycleStatus): void {
    const previous = this.lastLifecycle.get(agentId);
    this.lastLifecycle.set(agentId, lifecycle);
    if (previous === "running" && lifecycle === "idle") {
      this.scheduleDrain(agentId);
    }
  }

  /**
   * Drains run one at a time per agent. Chaining rather than dropping the request
   * matters: a wakeup that arrives while a drain is in flight is the wakeup for
   * the next item, and dropping it strands the rest of the queue.
   */
  private scheduleDrain(agentId: string): void {
    const previous = this.drainTails.get(agentId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.drain(agentId))
      .catch((error) => {
        this.logger.warn({ err: error, agentId }, "Failed to drain queued agent message");
      });
    this.drainTails.set(agentId, next);
    void next.finally(() => {
      if (this.drainTails.get(agentId) === next) {
        this.drainTails.delete(agentId);
      }
    });
  }

  /** Awaits in-flight drains. Tests and shutdown use it; nothing else should need it. */
  async flushDrains(): Promise<void> {
    while (this.drainTails.size > 0) {
      await Promise.all(Array.from(this.drainTails.values()));
      await Promise.resolve();
    }
  }

  /**
   * Sends the head of the queue when the agent is free. Serialized per agent so a
   * burst of state events cannot send the same item twice.
   */
  private async drain(agentId: string): Promise<void> {
    const agent = this.agentManager.getAgent(agentId);
    if (agent && agent.lifecycle !== "idle" && agent.lifecycle !== "closed") {
      return;
    }
    const queue = await this.store.get(agentId);
    const next = queue.items[0];
    if (!next) {
      return;
    }

    // Claim the head before sending so a concurrent drain cannot send it twice.
    // Remembering the drained id makes a late enqueue retry of this item a no-op.
    const claimed = await this.store.mutate(agentId, (current) =>
      current.items[0]?.id === next.id
        ? {
            ...current,
            items: current.items.slice(1),
            drainedIds: recordDrainedId(current.drainedIds, next.id),
          }
        : // Someone else changed the head while we were reading; try again later.
          current,
    );
    if (!claimed.changed) {
      return;
    }
    this.publish(claimed);

    try {
      await this.sendPrompt({
        agentId,
        prompt: buildAgentPrompt(next.text, next.images, next.attachments as AgentAttachment[]),
        messageId: next.id,
      });
    } catch (error) {
      this.logger.warn(
        { err: error, agentId, itemId: next.id },
        "Queued agent message failed to send; returning it to the front of the queue",
      );
      const restored = await this.store.mutate(agentId, (current) => ({
        ...current,
        items: [next, ...current.items],
        // The item is queued again, so its id must not read as already-delivered.
        drainedIds: (current.drainedIds ?? []).filter((id) => id !== next.id),
      }));
      this.publish(restored);
    }
  }

  private publish(result: AgentQueueMutationResult): void {
    if (!result.changed) {
      return;
    }
    const snapshot = toAgentQueueSnapshot(result.queue);
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        this.logger.warn(
          { err: error, agentId: result.queue.agentId },
          "Agent queue listener failed",
        );
      }
    }
  }
}
