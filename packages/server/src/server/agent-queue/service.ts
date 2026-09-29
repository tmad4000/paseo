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
import { wrapSpokenInput } from "../voice-config.js";
import type { MessageReceipts } from "../message-receipts/index.js";
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
  origin?: "voice";
  voiceOwner?: string;
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

export type AgentQueueAgentController = Pick<AgentManager, "subscribe" | "getAgent"> &
  Partial<Pick<AgentManager, "getPendingPermissions" | "hasInFlightRun">>;

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
  private receipts: MessageReceipts | null = null;

  private readonly listeners = new Set<AgentQueueMutationListener>();
  private readonly lastPermissionCount = new Map<string, number>();
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
      (async (input) => {
        await sendPromptToAgent({
          agentManager: this.agentManager as AgentManager,
          agentStorage: this.agentStorage,
          agentId: input.agentId,
          prompt: input.prompt,
          messageId: input.messageId,
          replaceRunning: false,
          blockPendingPermissions: true,
          awaitRunStart: true,
          logger: this.logger,
        });
      });
  }

  /** Reuse the daemon's direct-send receipt owner once the WebSocket server constructs it. */
  setMessageReceipts(receipts: MessageReceipts): void {
    this.receipts = receipts;
  }

  start(): void {
    if (this.unsubscribeAgentEvents) {
      return;
    }
    this.unsubscribeAgentEvents = this.agentManager.subscribe((event) => {
      if (event.type === "agent_stream" && event.event.type === "permission_resolved") {
        this.scheduleDrain(event.agentId);
        return;
      }
      if (event.type !== "agent_state") {
        return;
      }
      const permissionCount =
        event.agent.pendingPermissions?.size ??
        this.agentManager.getPendingPermissions?.(event.agent.id).length ??
        0;
      const previousCount = this.lastPermissionCount.get(event.agent.id) ?? 0;
      this.lastPermissionCount.set(event.agent.id, permissionCount);
      if (previousCount > 0 && permissionCount === 0) this.scheduleDrain(event.agent.id);
      this.handleAgentState(event.agent.id, event.agent.lifecycle);
    });
  }

  stop(): void {
    this.unsubscribeAgentEvents?.();
    this.unsubscribeAgentEvents = null;
    this.listeners.clear();
    this.lastLifecycle.clear();
    this.lastPermissionCount.clear();
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

  async listVoiceInputs(
    agentId: string,
    attachmentId: string,
    voiceOwner?: string,
  ): Promise<StoredQueuedMessage[]> {
    const queue = await this.store.get(agentId);
    return queue.items.filter(
      (item) =>
        item.origin === "voice" &&
        item.voiceOwner === voiceOwner &&
        item.id.startsWith(`${attachmentId}:`),
    );
  }

  async enqueue(input: EnqueueAgentMessageInput): Promise<AgentQueueSnapshot> {
    const text = input.text;
    const attachments = input.attachments ?? [];
    const images = input.images ?? [];
    if (!text.trim() && attachments.length === 0 && images.length === 0) {
      throw new Error("Cannot queue an empty message");
    }

    const item: StoredQueuedMessage = {
      id: input.itemId,
      text,
      ...(input.origin ? { origin: input.origin, voiceOwner: input.voiceOwner } : {}),
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

    const result = await this.store.mutate(input.agentId, async (current) => {
      const existing = current.items.find((candidate) => candidate.id === item.id);
      if (existing) {
        const samePayload =
          existing.text === item.text &&
          existing.origin === item.origin &&
          existing.voiceOwner === item.voiceOwner &&
          JSON.stringify(existing.attachments ?? []) === JSON.stringify(item.attachments ?? []) &&
          JSON.stringify(
            existing.images?.map(({ data, mimeType }) => ({ data, mimeType })) ?? [],
          ) === JSON.stringify(images);
        if (!samePayload) throw new Error("agent_request_key_conflict");
        return current;
      }
      if (this.receipts) {
        const { request } = this.receiptRequest(item);
        const receiptState = await this.receipts.get(input.agentId, input.itemId, request);
        if (receiptState === "completed" || receiptState === "removed") return current;
        if (receiptState === "pending") throw new Error("agent_request_outcome_unknown");
      }
      // A receipt remains durable after the bounded legacy drained-id window expires.
      return current.drainedIds?.includes(item.id)
        ? current
        : { ...current, items: [...current.items, item] };
    });
    this.publish(result);
    this.scheduleDrain(input.agentId);
    return toAgentQueueSnapshot(result.queue);
  }

  async remove(agentId: string, itemId: string): Promise<AgentQueueSnapshot> {
    const queued = await this.store.get(agentId);
    const queuedItem = queued.items.find((candidate) => candidate.id === itemId);
    if (queuedItem && this.receipts) {
      const { request } = this.receiptRequest(queuedItem);
      const removed = await this.receipts.recordRemoved({
        agentId,
        messageId: itemId,
        request,
        ...(queuedItem.origin === "voice"
          ? {
              attachmentId: itemId.split(":", 1)[0],
              voiceOwner: queuedItem.voiceOwner,
              createdAt: queuedItem.createdAt,
            }
          : {}),
      });
      if (!removed) throw new Error("Queued message is already being submitted");
    }
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
    this.lastPermissionCount.delete(agentId);
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
    if (this.agentManager.hasInFlightRun?.(agentId)) return;
    if (agent && this.agentManager.getPendingPermissions?.(agentId).length) return;
    const queue = await this.store.get(agentId);
    const next = queue.items[0];
    if (!next) {
      return;
    }

    if (this.receipts) {
      const { prompt, request } = this.receiptRequest(next);
      const receiptState = await this.receipts.get(agentId, next.id, request);
      if (receiptState === "pending") return;
      if (receiptState === "absent") {
        try {
          await this.receipts.send({
            agentId,
            messageId: next.id,
            ...(next.origin === "voice"
              ? {
                  attachmentId: next.id.split(":", 1)[0],
                  voiceOwner: next.voiceOwner,
                  createdAt: next.createdAt,
                }
              : {}),
            request,
            send: () =>
              this.sendPrompt({ agentId, prompt, messageId: next.id }).then(() => undefined),
          });
        } catch (error) {
          this.logger.warn(
            { err: error, agentId, itemId: next.id },
            "Queued message was not confirmed submitted",
          );
          // Wake connected receipt readers after the dispatch owner has settled.
          if ((await this.receipts.get(agentId, next.id)) === "pending") {
            this.publish(await this.store.mutate(agentId, (current) => ({ ...current })));
          }
          return;
        }
      }
      const drained = await this.store.mutate(agentId, (current) =>
        current.items.some((item) => item.id === next.id)
          ? {
              ...current,
              items: current.items.filter((item) => item.id !== next.id),
              drainedIds: recordDrainedId(current.drainedIds, next.id),
            }
          : current,
      );
      this.publish(drained);
      if (drained.changed) this.scheduleDrain(agentId);
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

  private receiptRequest(input: {
    text: string;
    origin?: "voice";
    voiceOwner?: string;
    images?: Array<{ data: string; mimeType: string }>;
    attachments?: AgentAttachment[];
  }): {
    prompt: AgentPromptInput;
    request: {
      prompt: AgentPromptInput;
      origin?: string;
      voiceOwner?: string;
      activeTurnBehavior?: "interrupt";
    };
  } {
    const prompt = buildAgentPrompt(
      input.origin === "voice" ? wrapSpokenInput(input.text) : input.text,
      input.images,
      input.attachments,
    );
    // COMPAT(directSendReceipts): preserve pre-queue typed fingerprints, added in fork v0.10.0-beta.1; retain until old receipts are retired.
    return {
      prompt,
      request:
        input.origin === "voice"
          ? { prompt, origin: "voice", voiceOwner: input.voiceOwner }
          : { prompt, activeTurnBehavior: "interrupt" },
    };
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
