import type { AgentProvider } from "@getpaseo/protocol/agent-types";
import type { AgentSnapshotPayload } from "@getpaseo/protocol/messages";
import {
  buildDraftAgentConfig,
  type DraftAgentSelection,
  type WorkspaceDraftAgentRequest,
} from "@/composer/draft/create-agent-request";
import type { HostProjectListItem } from "@/projects/host-projects";
import type {
  CreateProjectWorkspaceInput,
  WorkspaceCreationResult,
} from "@/screens/new-workspace/create-workspace";

export type QuickLaunchTarget =
  | {
      kind: "new-workspace";
      serverId: string;
      project: HostProjectListItem;
      sourceDirectory: string;
      createsWorktree: boolean;
    }
  | {
      kind: "existing-workspace";
      serverId: string;
      workspaceId: string;
      workspaceDirectory: string;
    };

export interface QuickLaunchSubmission {
  /** Unique per Start press; keys workspace idempotency and the first message. */
  launchId: string;
  worktreeSlug: string;
  target: QuickLaunchTarget;
  text: string;
  provider: AgentProvider;
  /** A snapshot of the Agent controls at Start. */
  selection: DraftAgentSelection;
}

export interface QuickLaunchStarted {
  serverId: string;
  workspaceId: string;
  agentId: string;
}

/** The two daemon calls Quick launch makes. Production wires the shared creation functions. */
export interface QuickLaunchPorts {
  createWorkspace: (
    input: Omit<CreateProjectWorkspaceInput, "client" | "queryClient">,
  ) => Promise<WorkspaceCreationResult>;
  createAgent: (
    serverId: string,
    request: WorkspaceDraftAgentRequest,
  ) => Promise<AgentSnapshotPayload>;
}

export interface QuickLaunchErrorLabels {
  createFailed: string;
  noAgent: string;
}

/**
 * Starts one agent for one Start press with exactly one create request. A new workspace and its
 * agent are created atomically by create_workspace, so no create_agent follows it; the daemon
 * does not dedupe create_agent, and nothing here leaves a pending draft entry that a workspace
 * draft tab could submit again.
 */
export async function runQuickLaunch(
  submission: QuickLaunchSubmission,
  ports: QuickLaunchPorts,
  labels: QuickLaunchErrorLabels,
): Promise<QuickLaunchStarted> {
  const { target } = submission;
  const clientMessageId = `${submission.launchId}:initial-message`;
  if (target.kind === "existing-workspace") {
    const agent = await ports.createAgent(target.serverId, {
      workspaceId: target.workspaceId,
      config: buildDraftAgentConfig({
        provider: submission.provider,
        cwd: target.workspaceDirectory,
        selection: submission.selection,
      }),
      text: submission.text,
      clientMessageId,
    });
    return { serverId: target.serverId, workspaceId: target.workspaceId, agentId: agent.id };
  }
  const { workspace, agent } = await ports.createWorkspace({
    serverId: target.serverId,
    project: target.project,
    sourceDirectory: target.sourceDirectory,
    createsWorktree: target.createsWorktree,
    baseItem: null,
    idempotencyKey: submission.launchId,
    worktreeSlug: submission.worktreeSlug,
    withInitialAgent: true,
    prompt: submission.text,
    attachments: [],
    agent: {
      config: buildDraftAgentConfig({
        provider: submission.provider,
        cwd: target.sourceDirectory,
        selection: submission.selection,
      }),
      initialPrompt: submission.text,
      clientMessageId,
    },
    createFailedMessage: labels.createFailed,
  });
  if (!agent) throw new Error(labels.noAgent);
  return { serverId: target.serverId, workspaceId: workspace.id, agentId: agent.id };
}
