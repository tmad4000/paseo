import { describe, expect, it } from "vitest";
import type { HostProjectListItem } from "@/projects/host-projects";
import {
  destinationOfTarget,
  findProjectChoice,
  projectChoiceOfDestination,
  resolveCreatesWorktree,
  resolveQuickLaunchDefaultDestination,
  resolveQuickLaunchSelection,
  resolveQuickLaunchTarget,
  workspaceOfDestination,
} from "./destination";

function project(input: {
  viewKey: string;
  name: string;
  hosts: { serverId: string; projectId: string; root: string }[];
  workspaceIds?: string[];
  kind?: HostProjectListItem["projectKind"];
}): HostProjectListItem {
  return {
    viewKey: input.viewKey,
    projectKey: null,
    projectName: input.name,
    projectKind: input.kind ?? "non_git",
    iconWorkingDir: input.hosts[0]!.root,
    hosts: input.hosts.map((host) => ({
      serverId: host.serverId,
      projectId: host.projectId,
      iconWorkingDir: host.root,
      worktreeSupport: input.kind === "git" ? "supported" : "unsupported",
    })),
    workspaceKeys: (input.workspaceIds ?? []).map(
      (workspaceId) => `${input.hosts[0]!.serverId}:${workspaceId}`,
    ),
  };
}

const scratch = project({
  viewKey: "view-scratch",
  name: "tmpworkspace",
  hosts: [
    {
      serverId: "m4",
      projectId: "prj_scratch",
      root: "/Volumes/External_SSD/macmini-relocated/code/tmpworkspace",
    },
  ],
  // Many directory workspaces share the project root, as on the M4.
  workspaceIds: ["ws-1", "ws-2", "ws-3"],
});
const paseo = project({
  viewKey: "view-paseo",
  name: "paseo",
  kind: "git",
  hosts: [{ serverId: "m4", projectId: "prj_paseo", root: "/Users/jacob/code/paseo" }],
  workspaceIds: ["ws-paseo"],
});
const remote = project({
  viewKey: "view-remote",
  name: "notes",
  hosts: [{ serverId: "m3", projectId: "prj_notes", root: "/Users/jacobcole/notes" }],
  workspaceIds: ["ws-notes"],
});

describe("resolveQuickLaunchDefaultDestination", () => {
  it("picks the scratch project even when it has many workspaces", () => {
    expect(
      resolveQuickLaunchDefaultDestination({
        projects: [paseo, scratch],
        serverIds: ["m4"],
        active: { serverId: "m4", workspaceId: "ws-paseo" },
        defaultProjects: [],
      }),
    ).toEqual({ serverId: "m4", projectViewKey: "view-scratch" });
  });

  it("prefers the active workspace's host when several hosts are connected", () => {
    expect(
      resolveQuickLaunchDefaultDestination({
        projects: [paseo, scratch, remote],
        serverIds: ["m4", "m3"],
        active: { serverId: "m4", workspaceId: "ws-paseo" },
        defaultProjects: [],
      }),
    ).toEqual({ serverId: "m4", projectViewKey: "view-scratch" });
  });

  it("falls back to the active workspace's project when the host has no scratch project", () => {
    expect(
      resolveQuickLaunchDefaultDestination({
        projects: [paseo, scratch, remote],
        serverIds: ["m4", "m3"],
        active: { serverId: "m3", workspaceId: "ws-notes" },
        defaultProjects: [],
      }),
    ).toEqual({ serverId: "m3", projectViewKey: "view-remote" });
  });

  it("prefers the host's Default project over the scratch project", () => {
    expect(
      resolveQuickLaunchDefaultDestination({
        projects: [paseo, scratch],
        serverIds: ["m4"],
        active: { serverId: "m4", workspaceId: "ws-1" },
        defaultProjects: [{ serverId: "m4", projectViewKey: "view-paseo" }],
      }),
    ).toEqual({ serverId: "m4", projectViewKey: "view-paseo" });
  });

  it("ignores another host's Default project", () => {
    expect(
      resolveQuickLaunchDefaultDestination({
        projects: [paseo, scratch, remote],
        serverIds: ["m4", "m3"],
        active: { serverId: "m4", workspaceId: "ws-paseo" },
        defaultProjects: [{ serverId: "m3", projectViewKey: "view-remote" }],
      }),
    ).toEqual({ serverId: "m4", projectViewKey: "view-scratch" });
  });

  it("returns null when nothing identifies a project", () => {
    expect(
      resolveQuickLaunchDefaultDestination({
        projects: [paseo, remote],
        serverIds: ["m4", "m3"],
        active: null,
        defaultProjects: [],
      }),
    ).toBeNull();
  });
});

describe("findProjectChoice", () => {
  it("returns the project only when it lives on the chosen host", () => {
    expect(findProjectChoice([scratch], { serverId: "m4", projectViewKey: "view-scratch" })).toBe(
      scratch,
    );
    expect(
      findProjectChoice([scratch], { serverId: "m3", projectViewKey: "view-scratch" }),
    ).toBeNull();
    expect(findProjectChoice([scratch], { serverId: "m4", projectViewKey: null })).toBeNull();
  });
});

describe("resolveCreatesWorktree", () => {
  it("follows the remembered Isolation choice where worktrees are possible", () => {
    const base = { supportsMultiplicity: true, worktreeSupport: "supported" as const };
    expect(resolveCreatesWorktree({ ...base, isolation: "worktree" })).toBe(true);
    expect(resolveCreatesWorktree({ ...base, isolation: "local" })).toBe(false);
    expect(
      resolveCreatesWorktree({ ...base, worktreeSupport: "unsupported", isolation: "worktree" }),
    ).toBe(false);
  });

  it("always creates a worktree on hosts without workspace multiplicity", () => {
    expect(
      resolveCreatesWorktree({
        supportsMultiplicity: false,
        worktreeSupport: "supported",
        isolation: "local",
      }),
    ).toBe(true);
  });
});

describe("resolveQuickLaunchTarget", () => {
  const choices = {
    serverId: "m4",
    supportsMultiplicity: true,
    isolation: "local" as const,
    worktreeSupport: "unsupported" as const,
  };

  it("creates a new workspace on the project's directory on its host", () => {
    expect(
      resolveQuickLaunchTarget({
        ...choices,
        where: "new-workspace",
        workspace: null,
        project: scratch,
      }),
    ).toEqual({
      kind: "new-workspace",
      serverId: "m4",
      project: scratch,
      sourceDirectory: "/Volumes/External_SSD/macmini-relocated/code/tmpworkspace",
      createsWorktree: false,
    });
  });

  it("starts a new tab in the given workspace", () => {
    expect(
      resolveQuickLaunchTarget({
        ...choices,
        where: "existing-workspace",
        workspace: { serverId: "m4", workspaceId: "ws-paseo", workspaceDirectory: "/w/paseo" },
        project: scratch,
      }),
    ).toEqual({
      kind: "existing-workspace",
      serverId: "m4",
      workspaceId: "ws-paseo",
      workspaceDirectory: "/w/paseo",
    });
  });

  it("cannot start without a destination", () => {
    expect(
      resolveQuickLaunchTarget({
        ...choices,
        where: "new-workspace",
        workspace: null,
        project: null,
      }),
    ).toBeNull();
    expect(
      resolveQuickLaunchTarget({
        ...choices,
        where: "existing-workspace",
        workspace: null,
        project: scratch,
      }),
    ).toBeNull();
    expect(
      resolveQuickLaunchTarget({
        ...choices,
        serverId: "m3",
        where: "new-workspace",
        workspace: null,
        project: scratch,
      }),
    ).toBeNull();
  });
});

describe("resolveQuickLaunchSelection", () => {
  const base = {
    projects: [paseo, scratch],
    projectChoice: { serverId: "m4", projectViewKey: "view-scratch" },
    projectServerId: "m4",
    supportsMultiplicity: true,
    isolation: "local" as const,
  };

  it("names the tab workspace's project and host when starting a new tab", () => {
    const selection = resolveQuickLaunchSelection({
      ...base,
      where: "existing-workspace",
      tabWorkspace: { serverId: "m4", workspaceId: "ws-paseo", workspaceDirectory: "/w/paseo" },
    });

    expect(selection.where).toBe("existing-workspace");
    expect(selection.shownProject).toBe(paseo);
    expect(selection.target).toEqual({
      kind: "existing-workspace",
      serverId: "m4",
      workspaceId: "ws-paseo",
      workspaceDirectory: "/w/paseo",
    });
  });

  it("falls back to a new workspace when the tab workspace is unknown", () => {
    const selection = resolveQuickLaunchSelection({
      ...base,
      where: "existing-workspace",
      tabWorkspace: null,
    });

    expect(selection.where).toBe("new-workspace");
    expect(selection.shownProject).toBe(scratch);
    expect(selection.target?.kind).toBe("new-workspace");
  });
});

describe("destination round trip", () => {
  it("reopens Retry on the same project or workspace", () => {
    expect(
      projectChoiceOfDestination(
        destinationOfTarget({
          kind: "new-workspace",
          serverId: "m4",
          project: scratch,
          sourceDirectory: "/scratch",
          createsWorktree: false,
        }),
      ),
    ).toEqual({ serverId: "m4", projectViewKey: "view-scratch" });
    expect(
      workspaceOfDestination(
        destinationOfTarget({
          kind: "existing-workspace",
          serverId: "m4",
          workspaceId: "ws-paseo",
          workspaceDirectory: "/w/paseo",
        }),
      ),
    ).toEqual({ serverId: "m4", workspaceId: "ws-paseo" });
  });
});
