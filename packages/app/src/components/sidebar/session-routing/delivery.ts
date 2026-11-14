import type { AgentQueueSnapshot } from "@getpaseo/protocol/messages";
import type {
  PendingQueueEnqueue,
  QueueOutboxFlushClient,
} from "@/stores/queue-outbox-store/model";
import { serializeQueueOperation } from "@/stores/queue-outbox-store/model";
import { runOrderedAdmission } from "@/stores/delivery-outboxes";
import type { Recipient } from "./model";
import { AgentQueueDestinationChangedError } from "@getpaseo/client/internal/daemon-client";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import {
  dispatchComposerAgentMessage,
  type ComposerSendClient,
  type MessageSubmissionWriter,
} from "@/composer/actions";
import type { SendBehavior } from "@/composer/input/state";

export interface DirectRouteDeliveryInput {
  recipient: Recipient;
  text: string;
  mode: Exclude<SendBehavior, "queue">;
  client: ComposerSendClient & Pick<DaemonClient, "fetchAgent">;
  submission: MessageSubmissionWriter;
  isHostEligible: () => boolean;
  isDestinationCurrent: () => boolean;
  supportsSteerOnly: () => boolean;
  getTurn: () => { isActive: boolean; turnId: string | null };
}

export class DirectRouteDeliveryError extends Error {
  constructor(public readonly reason: "host" | "destination" | "steerUnsupported" | "uncertain") {
    const messages = {
      host: "The selected host is unavailable or excluded. Choose a destination again.",
      destination:
        "The selected conversation moved or is no longer available. Choose a destination again.",
      steerUnsupported: "Update the selected host to steer an active conversation.",
      uncertain:
        "Delivery could not be confirmed. Check the destination conversation before sending again.",
    };
    super(messages[reason]);
    this.name = "DirectRouteDeliveryError";
  }
}

export async function deliverDirectRoutedPrompt(
  input: DirectRouteDeliveryInput,
): Promise<{ queued: false }> {
  if (!input.isHostEligible()) throw new DirectRouteDeliveryError("host");
  const activeTurnBehavior = input.mode === "steer" ? "steer_only" : "interrupt";
  let behavior: "steer_only" | "interrupt" | undefined = activeTurnBehavior;
  let interrupt = false;
  await dispatchComposerAgentMessage({
    serverId: input.recipient.serverId,
    deliveryClient: {
      sendAgentMessage: async (agentId, text, options) =>
        (await input.client.sendAgentMessage(agentId, text, options)) ?? { queued: false },
      enqueueAgentMessage: input.client.enqueueAgentMessage?.bind(input.client),
      removeQueuedAgentMessage: input.client.removeQueuedAgentMessage?.bind(input.client),
      getLastServerInfoMessage: input.client.getLastServerInfoMessage?.bind(input.client),
    },
    beforeDispatch: async () => {
      const current = await input.client.fetchAgent(input.recipient.agentId);
      if (!input.isHostEligible()) throw new DirectRouteDeliveryError("host");
      const matchesDestination =
        current?.agent.id === input.recipient.agentId &&
        current.agent.workspaceId === input.recipient.workspaceId &&
        !current.agent.archivedAt &&
        input.isDestinationCurrent();
      if (!matchesDestination) throw new DirectRouteDeliveryError("destination");
      const turn = input.getTurn();
      if (input.mode === "steer" && !input.supportsSteerOnly()) {
        if (turn.isActive) throw new DirectRouteDeliveryError("steerUnsupported");
        behavior = undefined;
      }
      interrupt = input.mode === "interrupt" && turn.isActive;
    },
    client: {
      uploadFile: (value) => input.client.uploadFile(value),
      sendAgentMessage: async (agentId, text, options) => {
        try {
          return await input.client.sendAgentMessage(agentId, text, {
            ...options,
            activeTurnBehavior: behavior,
            ...(interrupt ? { interrupt: true } : {}),
          });
        } catch (cause) {
          const error = new DirectRouteDeliveryError("uncertain");
          error.cause = cause;
          throw error;
        }
      },
    },
    agentId: input.recipient.agentId,
    text: input.text,
    attachments: [],
    encodeImages: async () => undefined,
    submission: input.submission,
    activeTurnBehavior,
    activeTurnId: input.mode === "steer" ? (input.getTurn().turnId ?? undefined) : undefined,
  });
  return { queued: false };
}

export interface RouteDeliveryInput {
  recipient: Recipient;
  text: string;
  itemId: string;
  draftVersion: number;
  draftUpdatedAt?: number;
  requireExisting?: boolean;
  client: QueueOutboxFlushClient;
  isHostEligible: () => boolean;
  outbox: {
    getEntry: (itemId: string) => Promise<PendingQueueEnqueue | undefined>;
    getAcknowledgement?: (itemId: string) => { queued: boolean } | undefined;
    markRoutingDispatched: (itemId: string) => Promise<void>;
    add: (entry: Omit<PendingQueueEnqueue, "createdAt" | "attempts">) => Promise<void>;
    removeDurably: (itemId: string, preserveRemovalIntent?: boolean) => Promise<void>;
    acknowledge: (itemId: string, snapshot: AgentQueueSnapshot) => Promise<boolean>;
  };
  applySnapshot: (snapshot: AgentQueueSnapshot) => void;
}

export async function deliverRoutedPrompt(input: RouteDeliveryInput): Promise<{ queued: boolean }> {
  const { recipient, text, itemId } = input;
  return serializeQueueOperation(
    JSON.stringify(["route-prepare", recipient.serverId, recipient.agentId]),
    async () => {
      const existing = await input.outbox.getEntry(itemId);
      const acknowledged = input.outbox.getAcknowledgement?.(itemId);
      if (!existing && acknowledged)
        return { status: "acknowledged" as const, result: acknowledged };
      if (existing?.removalRequested || (input.requireExisting && !existing))
        throw new Error("Delivery canceled or no longer pending.");
      const enqueue = existing ?? {
        serverId: recipient.serverId,
        agentId: recipient.agentId,
        itemId,
        text,
        expectedWorkspaceId: recipient.workspaceId,
        expectedProjectId: recipient.projectId,
        routingOrigin: true,
        routingDispatchHeld: true,
        routingDraftVersion: input.draftVersion,
        routingDraftUpdatedAt: input.draftUpdatedAt,
        images: [],
        attachments: [],
        composerAttachments: [],
      };
      if (!existing) await input.outbox.add(enqueue);
      const current = await input.outbox.getEntry(itemId);
      if (!current) {
        const completed = input.outbox.getAcknowledgement?.(itemId);
        if (completed) return { status: "acknowledged" as const, result: completed };
        throw new Error("Delivery cancellation is pending.");
      }
      if (current.removalRequested) throw new Error("Delivery cancellation is pending.");
      if (!input.isHostEligible()) {
        if (!existing) await input.outbox.removeDurably(itemId);
        throw new Error("The selected host was excluded. Choose a destination again.");
      }
      return { status: "pending" as const, enqueue, existing, current };
    },
  ).then((prepared) => {
    if (prepared.status === "acknowledged") return prepared.result;
    const { enqueue, existing, current } = prepared;
    return runOrderedAdmission({
      serverId: recipient.serverId,
      agentId: recipient.agentId,
      itemId,
      createdAt: current.createdAt,
      client: input.client,
      isPending: async () => {
        const entry = await input.outbox.getEntry(itemId);
        return Boolean(
          (entry && !entry.removalRequested) ||
          (!entry && input.outbox.getAcknowledgement?.(itemId)),
        );
      },
      run: () =>
        serializeQueueOperation(
          JSON.stringify(["dispatch", recipient.serverId, recipient.agentId]),
          async () => {
            const pending = await input.outbox.getEntry(itemId);
            if (!pending) {
              const completed = input.outbox.getAcknowledgement?.(itemId);
              if (completed) return completed;
              throw new Error("Delivery cancellation is pending.");
            }
            if (pending.removalRequested) throw new Error("Delivery cancellation is pending.");
            if (!input.isHostEligible()) {
              if (!existing) await input.outbox.removeDurably(itemId);
              throw new Error("The selected host was excluded. Choose a destination again.");
            }
            let snapshot: AgentQueueSnapshot;
            try {
              const request = input.client.enqueueAgentMessage(enqueue);
              const marker = input.outbox.markRoutingDispatched(itemId).catch(() => {});
              const outcome = await Promise.allSettled([request, marker]);
              if (outcome[0].status === "rejected") throw outcome[0].reason;
              snapshot = outcome[0].value;
            } catch (error) {
              if (error instanceof AgentQueueDestinationChangedError)
                await input.outbox.removeDurably(itemId);
              throw error;
            }
            const acknowledged = await input.outbox.acknowledge(itemId, snapshot);
            if (!acknowledged || (await input.outbox.getEntry(itemId))?.removalRequested)
              throw new Error("Delivery cancellation is pending.");
            input.applySnapshot(snapshot);
            await input.outbox.removeDurably(itemId, true);
            if ((await input.outbox.getEntry(itemId))?.removalRequested)
              throw new Error("Delivery cancellation is pending.");
            return { queued: snapshot.items.some((item) => item.id === itemId) };
          },
        ),
    });
  });
}
