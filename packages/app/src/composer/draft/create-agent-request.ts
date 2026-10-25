import type { AgentProvider, AgentSessionConfig } from "@getpaseo/protocol/agent-types";
import type { AgentSnapshotPayload, CreateAgentRequestMessage } from "@getpaseo/protocol/messages";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { encodeImages } from "@/utils/encode-images";
import type { UserMessageImageAttachment } from "@/types/stream";

/** The Agent controls' current picks, as the draft composer resolves them. */
export interface DraftAgentSelection {
  selectedMode: string;
  effectiveModelId: string;
  effectiveThinkingOptionId: string;
  featureValues: Record<string, unknown> | undefined;
}

/** The session config a draft's Agent controls describe, running in `cwd`. */
export function buildDraftAgentConfig(input: {
  provider: AgentProvider;
  cwd: string;
  selection: DraftAgentSelection;
}): AgentSessionConfig {
  return {
    provider: input.provider,
    cwd: input.cwd,
    modeId: input.selection.selectedMode || undefined,
    model: input.selection.effectiveModelId || undefined,
    thinkingOptionId: input.selection.effectiveThinkingOptionId || undefined,
    featureValues: input.selection.featureValues,
  };
}

export interface WorkspaceDraftAgentRequest {
  workspaceId: string;
  config: AgentSessionConfig;
  text: string;
  clientMessageId: string;
  images?: UserMessageImageAttachment[];
  attachments?: CreateAgentRequestMessage["attachments"];
}

/**
 * Shared by the workspace draft tab, by the new-workspace screen when it finishes creation
 * after the user has already navigated away and no draft tab will ever mount, and by Quick
 * launch when it starts an agent in an existing workspace.
 */
export async function requestWorkspaceDraftAgent(
  client: DaemonClient,
  request: WorkspaceDraftAgentRequest,
): Promise<AgentSnapshotPayload> {
  const images = await encodeImages(request.images);
  return await client.createAgent({
    config: request.config,
    workspaceId: request.workspaceId,
    clientMessageId: request.clientMessageId,
    ...(request.text ? { initialPrompt: request.text } : {}),
    ...(images && images.length > 0 ? { images } : {}),
    ...(request.attachments && request.attachments.length > 0
      ? { attachments: request.attachments }
      : {}),
  });
}
