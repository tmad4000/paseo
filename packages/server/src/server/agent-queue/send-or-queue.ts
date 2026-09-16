import { randomUUID } from "node:crypto";
import type { Logger } from "pino";

import type { AgentAttachment } from "@getpaseo/protocol/messages";

import { sendPromptToAgent } from "../agent/agent-prompt.js";
import type { AgentManager } from "../agent/agent-manager.js";
import type { AgentRunOptions } from "../agent/agent-sdk-types.js";
import type { AgentStorage } from "../agent/agent-storage.js";
import { buildAgentPrompt } from "../agent/prompt-attachments.js";
import type { AgentQueueService } from "./service.js";

export interface SendOrQueuePromptParams {
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  queueService: AgentQueueService | null;
  agentId: string;
  text: string;
  images?: Array<{ data: string; mimeType: string }>;
  attachments?: AgentAttachment[];
  messageId?: string;
  /** True cancels an in-flight turn (the old replace behavior). */
  interrupt?: boolean;
  runOptions?: AgentRunOptions;
  sessionMode?: string;
  unarchive?: boolean;
  logger: Logger;
  /**
   * Injected so tests can substitute the send without module mocks; defaults
   * to the same sendPromptToAgent every prompt surface uses.
   */
  send?: typeof sendPromptToAgent;
}

export interface SendOrQueueResult {
  queued: boolean;
  outOfBand: boolean;
}

/**
 * The busy policy for every prompt surface: a prompt aimed at an agent with an
 * in-flight turn is queued and delivered when the turn completes, because
 * interrupting the turn aborts its in-flight tool calls — including running
 * provider subagents. `interrupt: true` is the explicit opt-in for the old
 * cancel-and-replace behavior. Out-of-band commands (e.g. /goal pause) still
 * run immediately; they never touch the active turn.
 */
export async function sendOrQueuePromptToAgent(
  params: SendOrQueuePromptParams,
): Promise<SendOrQueueResult> {
  const { queueService } = params;
  if (!params.interrupt && queueService && params.agentManager.hasInFlightRun(params.agentId)) {
    const prompt = buildAgentPrompt(params.text, params.images, params.attachments);
    if (params.agentManager.tryRunOutOfBand(params.agentId, prompt, params.runOptions)) {
      return { queued: false, outOfBand: true };
    }
    if (params.sessionMode) {
      // Mode changes apply to the next turn anyway, so setting it now keeps
      // the queued prompt's intent even though delivery happens later.
      await params.agentManager.setAgentMode(params.agentId, params.sessionMode);
    }
    await queueService.enqueue({
      agentId: params.agentId,
      itemId: params.messageId ?? randomUUID(),
      text: params.text,
      ...(params.images?.length ? { images: params.images } : {}),
      ...(params.attachments?.length ? { attachments: params.attachments } : {}),
    });
    return { queued: true, outOfBand: false };
  }

  const send = params.send ?? sendPromptToAgent;
  const result = await send({
    agentManager: params.agentManager,
    agentStorage: params.agentStorage,
    agentId: params.agentId,
    prompt: buildAgentPrompt(params.text, params.images, params.attachments),
    ...(params.messageId ? { messageId: params.messageId } : {}),
    ...(params.runOptions ? { runOptions: params.runOptions } : {}),
    ...(params.sessionMode ? { sessionMode: params.sessionMode } : {}),
    ...(params.unarchive !== undefined ? { unarchive: params.unarchive } : {}),
    logger: params.logger,
  });
  return { queued: false, outOfBand: result.outOfBand };
}
