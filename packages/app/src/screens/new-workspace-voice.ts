import type { MessagePayload } from "@/composer/types";
import { isEmptyWorkspaceSubmission } from "./new-workspace-empty";

export type NewWorkspaceSubmissionKind = "empty-workspace" | "chat-agent";

/**
 * An empty submit from the New workspace screen creates only the workspace. Voice needs an agent
 * to attach to, so a voice start always takes the chat-agent path, even though it carries no text.
 */
export function resolveNewWorkspaceSubmissionKind(
  payload: MessagePayload,
  options: { forVoice: boolean },
): NewWorkspaceSubmissionKind {
  if (options.forVoice) return "chat-agent";
  return isEmptyWorkspaceSubmission(payload) ? "empty-workspace" : "chat-agent";
}

export interface CreateNewWorkspaceAgentForVoiceInput {
  /** The selected source directory; null before one is chosen (matches the composer's cwd). */
  cwd: string | null;
  /** Creates the workspace and its agent; resolves to null when nothing was created. */
  createChatAgent: (payload: MessagePayload) => Promise<{ agentId: string } | null>;
}

/**
 * Lets the voice button on a brand-new session work before any message is sent: it creates the
 * workspace and its agent with no prompt (so no turn starts) and resolves to the agent id voice
 * attaches to.
 */
export async function createNewWorkspaceAgentForVoice(
  input: CreateNewWorkspaceAgentForVoiceInput,
): Promise<string | null> {
  const created = await input.createChatAgent({
    text: "",
    attachments: [],
    cwd: input.cwd ?? "",
  });
  return created?.agentId ?? null;
}
