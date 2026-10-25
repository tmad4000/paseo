import { describe, expect, it } from "vitest";
import type { AgentSnapshotPayload } from "@getpaseo/protocol/messages";
import type { WorkspaceDraftAgentRequest } from "@/composer/draft/create-agent-request";
import type { HostProjectListItem } from "@/projects/host-projects";
import type {
  CreateProjectWorkspaceInput,
  WorkspaceCreationResult,
} from "@/screens/new-workspace/create-workspace";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { runQuickLaunch, type QuickLaunchPorts, type QuickLaunchSubmission } from "./launch";

type WorkspaceRequest = Omit<CreateProjectWorkspaceInput, "client" | "queryClient">;

function createRecordingPorts(input: { workspaceAgent: boolean }) {
  const workspaceRequests: WorkspaceRequest[] = [];
  const agentRequests: { serverId: string; request: WorkspaceDraftAgentRequest }[] = [];
  const ports: QuickLaunchPorts = {
    createWorkspace: async (request): Promise<WorkspaceCreationResult> => {
      workspaceRequests.push(request);
      return {
        workspace: { id: "ws-new" } as WorkspaceDescriptor,
        ...(input.workspaceAgent ? { agent: { id: "agent-new" } as AgentSnapshotPayload } : {}),
      };
    },
    createAgent: async (serverId, request) => {
      agentRequests.push({ serverId, request });
      return { id: "agent-tab" } as AgentSnapshotPayload;
    },
  };
  return { ports, workspaceRequests, agentRequests };
}

const scratch = {
  viewKey: "view-scratch",
  projectKey: null,
  projectName: "tmpworkspace",
  projectKind: "non_git",
  iconWorkingDir: "/scratch",
  hosts: [
    {
      serverId: "m4",
      projectId: "prj_scratch",
      iconWorkingDir: "/scratch",
      worktreeSupport: "unsupported",
    },
  ],
  workspaceKeys: [],
} satisfies HostProjectListItem;

const selection = {
  selectedMode: "default",
  effectiveModelId: "opus",
  effectiveThinkingOptionId: "",
  featureValues: undefined,
};
const labels = { createFailed: "Unable to create workspace", noAgent: "No agent" };

describe("runQuickLaunch", () => {
  it("creates a new workspace and its agent in one request", async () => {
    const recorded = createRecordingPorts({ workspaceAgent: true });
    const submission: QuickLaunchSubmission = {
      launchId: "draft_1",
      worktreeSlug: "brave-otter",
      target: {
        kind: "new-workspace",
        serverId: "m4",
        project: scratch,
        sourceDirectory: "/scratch",
        createsWorktree: false,
      },
      text: "Fix the flaky test",
      provider: "claude",
      selection,
    };

    const started = await runQuickLaunch(submission, recorded.ports, labels);

    expect(started).toEqual({ serverId: "m4", workspaceId: "ws-new", agentId: "agent-new" });
    expect(recorded.agentRequests).toEqual([]);
    expect(recorded.workspaceRequests).toEqual([
      {
        serverId: "m4",
        project: scratch,
        sourceDirectory: "/scratch",
        createsWorktree: false,
        baseItem: null,
        idempotencyKey: "draft_1",
        worktreeSlug: "brave-otter",
        withInitialAgent: true,
        prompt: "Fix the flaky test",
        attachments: [],
        agent: {
          config: {
            provider: "claude",
            cwd: "/scratch",
            modeId: "default",
            model: "opus",
            thinkingOptionId: undefined,
            featureValues: undefined,
          },
          initialPrompt: "Fix the flaky test",
          clientMessageId: "draft_1:initial-message",
        },
        createFailedMessage: "Unable to create workspace",
      },
    ]);
  });

  it("starts a new tab in an existing workspace with one create_agent", async () => {
    const recorded = createRecordingPorts({ workspaceAgent: true });

    const started = await runQuickLaunch(
      {
        launchId: "draft_2",
        worktreeSlug: "calm-heron",
        target: {
          kind: "existing-workspace",
          serverId: "m4",
          workspaceId: "ws-current",
          workspaceDirectory: "/scratch",
        },
        text: "Summarize the logs",
        provider: "codex",
        selection,
      },
      recorded.ports,
      labels,
    );

    expect(started).toEqual({ serverId: "m4", workspaceId: "ws-current", agentId: "agent-tab" });
    expect(recorded.workspaceRequests).toEqual([]);
    expect(recorded.agentRequests).toEqual([
      {
        serverId: "m4",
        request: {
          workspaceId: "ws-current",
          config: {
            provider: "codex",
            cwd: "/scratch",
            modeId: "default",
            model: "opus",
            thinkingOptionId: undefined,
            featureValues: undefined,
          },
          text: "Summarize the logs",
          clientMessageId: "draft_2:initial-message",
        },
      },
    ]);
  });

  it("fails without a follow-up create_agent when the workspace returns no agent", async () => {
    const recorded = createRecordingPorts({ workspaceAgent: false });

    await expect(
      runQuickLaunch(
        {
          launchId: "draft_3",
          worktreeSlug: "quiet-lynx",
          target: {
            kind: "new-workspace",
            serverId: "m4",
            project: scratch,
            sourceDirectory: "/scratch",
            createsWorktree: false,
          },
          text: "Hello",
          provider: "claude",
          selection,
        },
        recorded.ports,
        labels,
      ),
    ).rejects.toThrow("No agent");
    expect(recorded.workspaceRequests).toHaveLength(1);
    expect(recorded.agentRequests).toEqual([]);
  });
});
