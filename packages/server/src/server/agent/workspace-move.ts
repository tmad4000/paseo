import type { z } from "zod";
import { createRealpathAwarePathMatcher } from "../../utils/path.js";
import type { AgentWorkspaceMoveRequestSchema } from "@getpaseo/protocol/messages";
import type { AgentManager } from "./agent-manager.js";
import type { AgentStorage } from "./agent-storage.js";
import type {
  WorkspaceRegistry,
  ProjectRegistry,
  PersistedWorkspaceRecord,
} from "../workspace-registry.js";
import type { WorkspaceProvisioningService } from "../session/workspace-provisioning/workspace-provisioning-service.js";

import { runWorkspaceMutation } from "../workspace-mutations.js";

export const ASIDES_WORKSPACE_LABEL = "paseo:asides";

export interface MoveAgentWorkspaceDependencies {
  agentManager: Pick<AgentManager, "getAgent" | "moveAgentToWorkspace">;
  agentStorage: Pick<AgentStorage, "get">;
  workspaceRegistry: WorkspaceRegistry;
  projectRegistry: Pick<ProjectRegistry, "list" | "get">;
  workspaceProvisioning: Pick<WorkspaceProvisioningService, "createWorkspaceForDirectory">;
}

export type MoveAgentWorkspaceInput = Omit<
  z.infer<typeof AgentWorkspaceMoveRequestSchema>,
  "type" | "requestId"
>;

export function moveAgentWorkspace(
  deps: MoveAgentWorkspaceDependencies,
  input: MoveAgentWorkspaceInput,
): Promise<PersistedWorkspaceRecord> {
  return runWorkspaceMutation(deps.agentManager, () => move(deps, input));
}

async function move(
  deps: MoveAgentWorkspaceDependencies,
  input: MoveAgentWorkspaceInput,
): Promise<PersistedWorkspaceRecord> {
  const stored = await deps.agentStorage.get(input.agentId);
  const agent = deps.agentManager.getAgent(input.agentId) ?? stored;
  if (!agent || stored?.archivedAt) throw new Error("Chat is unavailable or archived");
  const source = await deps.workspaceRegistry.get(input.expectedWorkspaceId);
  if (!source || source.archivedAt) throw new Error("Source workspace is unavailable");
  const destination = input.destination;
  let workspace = await findDestination(deps, input);
  // A retry after a lost response must reuse the acknowledged destination.
  if (workspace && agent.workspaceId === workspace.workspaceId && !workspace.archivedAt)
    return workspace;
  if (agent.workspaceId !== input.expectedWorkspaceId)
    throw new Error("Chat has already moved. Reopen its tab and try again.");
  if (destination.kind === "existing" && !workspace)
    throw new Error("Destination workspace was not found");
  if (workspace?.archivedAt) throw new Error("Destination workspace is archived");
  if (!workspace) workspace = await createDestination(deps, input, source);
  const project = await deps.projectRegistry.get(workspace.projectId);
  if (!project || project.archivedAt) throw new Error("Destination project is unavailable");
  await deps.agentManager.moveAgentToWorkspace(input.agentId, {
    workspaceId: workspace.workspaceId,
    expectedWorkspaceId: input.expectedWorkspaceId,
  });
  await deps.workspaceRegistry.update(source.workspaceId, (record) => ({
    ...record,
    updatedAt: new Date().toISOString(),
  }));
  return workspace;
}

async function createDestination(
  deps: MoveAgentWorkspaceDependencies,
  input: MoveAgentWorkspaceInput,
  source: PersistedWorkspaceRecord,
): Promise<PersistedWorkspaceRecord> {
  const destination = input.destination;
  let workspace: PersistedWorkspaceRecord;
  let cwd = source.cwd;
  let projectId = source.projectId;
  let title = "Asides";
  let workspaceId: string | undefined;
  let labels = [ASIDES_WORKSPACE_LABEL];
  if (destination.kind === "new") {
    title = destination.title;
    workspaceId = destination.workspaceId;
    labels = [`paseo:moved-chat:${input.agentId}`];
  } else {
    const projects = await deps.projectRegistry.list();
    const defaultProject = projects
      .filter((entry) => !entry.archivedAt && entry.defaultAt)
      .sort((a, b) => (b.defaultAt ?? "").localeCompare(a.defaultAt ?? ""))[0];
    if (defaultProject) {
      cwd = defaultProject.rootPath;
      projectId = defaultProject.projectId;
    }
  }
  const created = await deps.workspaceProvisioning.createWorkspaceForDirectory(
    cwd,
    title,
    projectId,
    {
      workspaceId,
      untrustedSource: createRealpathAwarePathMatcher(source.cwd)(cwd)
        ? source.untrustedSource
        : undefined,
    },
  );
  workspace = { ...created, labels };
  if (destination.kind === "new") {
    // Keep ownership/recovery metadata when the original workspace owns a worktree.
    workspace = {
      ...source,
      workspaceId: created.workspaceId,
      title,
      labels,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
      pinnedAt: null,
      autoArchivedChangeRequestUrl: null,
    };
  }
  await deps.workspaceRegistry.upsert(workspace);
  return workspace;
}

async function findDestination(
  deps: MoveAgentWorkspaceDependencies,
  input: MoveAgentWorkspaceInput,
): Promise<PersistedWorkspaceRecord | null> {
  const workspaces = await deps.workspaceRegistry.list();
  const destination = input.destination;
  let workspace: PersistedWorkspaceRecord | null = null;
  if (destination.kind === "existing")
    workspace = await deps.workspaceRegistry.get(destination.workspaceId);
  if (destination.kind === "new") {
    workspace = await deps.workspaceRegistry.get(destination.workspaceId);
    if (workspace && !workspace.labels?.includes(`paseo:moved-chat:${input.agentId}`))
      throw new Error("Workspace ID is already in use");
  }
  if (destination.kind === "asides")
    workspace =
      workspaces.find(
        (entry) => !entry.archivedAt && entry.labels?.includes(ASIDES_WORKSPACE_LABEL),
      ) ?? null;
  return workspace;
}
