import type { QueryClient } from "@tanstack/react-query";
import type {
  CreateWorkspaceRequestOptions,
  DaemonClient,
} from "@getpaseo/client/internal/daemon-client";
import type {
  AgentAttachment,
  AgentSnapshotPayload,
  CreationSnapshot,
} from "@getpaseo/protocol/messages";
import { ensureCheckoutStatus } from "@/git/checkout-status-cache";
import { getHostProjectId, type HostProjectListItem } from "@/projects/host-projects";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { normalizeWorkspaceDescriptor, type WorkspaceDescriptor } from "@/stores/session-store";
import {
  defaultBasePickerItem,
  pickerItemToCheckoutRequest,
  type PickerItem,
} from "../new-workspace-picker-item";

export interface WorkspaceCreationResult {
  workspace: WorkspaceDescriptor;
  agent?: AgentSnapshotPayload;
}

export interface CreateProjectWorkspaceInput {
  client: DaemonClient;
  queryClient: QueryClient;
  serverId: string;
  project: HostProjectListItem;
  sourceDirectory: string;
  /** A Paseo worktree instead of a workspace on the project's own directory. */
  createsWorktree: boolean;
  /** Base ref for a worktree; `null` starts from the checkout's current branch. */
  baseItem: PickerItem | null;
  idempotencyKey: string;
  worktreeSlug: string;
  withInitialAgent: boolean;
  prompt: string;
  attachments: AgentAttachment[];
  agent?: CreateWorkspaceRequestOptions["agent"];
  onEvent?: (snapshot: CreationSnapshot) => void;
  createFailedMessage: string;
}

function buildFirstAgentContext(input: {
  prompt: string;
  attachments: AgentAttachment[];
}): { prompt?: string; attachments?: AgentAttachment[] } | undefined {
  const trimmedPrompt = input.prompt.trim();
  if (!trimmedPrompt && input.attachments.length === 0) {
    return undefined;
  }

  return {
    ...(trimmedPrompt ? { prompt: trimmedPrompt } : {}),
    attachments: input.attachments,
  };
}

/**
 * Creates one workspace in a project, optionally with its first agent in the same request.
 *
 * Shared by the New workspace screen and Quick launch. With `agent` set, the daemon creates the
 * workspace and the agent atomically, so the caller must not issue a separate create_agent for
 * the same prompt (see `background-handoff.ts`).
 */
export async function createProjectWorkspace(
  input: CreateProjectWorkspaceInput,
): Promise<WorkspaceCreationResult> {
  const projectId = getHostProjectId(input.project, input.serverId);
  if (!projectId) throw new Error("Project is not available on the selected host");
  const checkoutStatus = input.createsWorktree
    ? await ensureCheckoutStatus({
        queryClient: input.queryClient,
        client: input.client,
        serverId: input.serverId,
        cwd: input.sourceDirectory,
      })
    : null;
  const checkoutRequest = checkoutStatus
    ? pickerItemToCheckoutRequest(input.baseItem ?? defaultBasePickerItem(checkoutStatus))
    : undefined;
  const firstAgentContext = buildFirstAgentContext({
    prompt: input.prompt,
    attachments: input.attachments,
  });
  const payload = await input.client.createWorkspace({
    idempotencyKey: input.idempotencyKey,
    agent: input.agent,
    onEvent: input.onEvent,
    source: input.createsWorktree
      ? {
          kind: "worktree",
          cwd: input.sourceDirectory,
          projectId,
          worktreeSlug: input.worktreeSlug,
          ...checkoutRequest,
        }
      : {
          kind: "directory",
          path: input.sourceDirectory,
          projectId,
        },
    ...(firstAgentContext ? { firstAgentContext } : {}),
  });
  if (payload.error || !payload.workspace) {
    throw new Error(payload.error ?? input.createFailedMessage);
  }
  const workspace = normalizeWorkspaceDescriptor(payload.workspace);
  const workspaceForInitialMerge = input.withInitialAgent
    ? { ...workspace, status: "running" as const, statusEnteredAt: new Date() }
    : workspace;
  getHostRuntimeStore().acceptWorkspaceSnapshots(input.serverId, [workspaceForInitialMerge]);
  return { workspace, agent: payload.agent };
}
