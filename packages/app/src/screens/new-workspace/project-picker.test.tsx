// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { HostProjectListItem } from "@/projects/host-projects";
import { computeProjectOptionData, useNewWorkspaceProjectPicker } from "./project-picker";

function project(input: {
  viewKey: string;
  projectKey: string | null;
  projectId: string;
  projectName: string;
}): HostProjectListItem {
  return {
    ...input,
    projectKind: "git",
    iconWorkingDir: `/work/${input.projectId}`,
    hosts: [
      {
        serverId: "host",
        projectId: input.projectId,
        iconWorkingDir: `/work/${input.projectId}`,
        worktreeSupport: "supported",
      },
    ],
    workspaceKeys: [],
  };
}

describe("useNewWorkspaceProjectPicker", () => {
  it("preserves a manual choice when the routed project hydrates", () => {
    const routePlacement = project({
      viewKey: '["host","route-local"]',
      projectKey: null,
      projectId: "route-local",
      projectName: "Route project",
    });
    const hydratedRouteProject = project({
      viewKey: "remote:github.com/acme/route",
      projectKey: "remote:github.com/acme/route",
      projectId: "route-local",
      projectName: "Route project",
    });
    const manualProject = project({
      viewKey: "remote:github.com/acme/manual",
      projectKey: "remote:github.com/acme/manual",
      projectId: "manual-local",
      projectName: "Manual project",
    });
    const { result, rerender } = renderHook(
      ({ routeProject, projects }) =>
        useNewWorkspaceProjectPicker({
          selectedServerId: "host",
          projects,
          routeProject,
          routeProjectContextViewKey: routePlacement.viewKey,
          lastActiveProject: null,
          allowAllProjects: true,
        }),
      {
        initialProps: {
          routeProject: routePlacement,
          projects: [routePlacement, manualProject],
        },
      },
    );

    const manualOption = result.current.projectPickerOptions.find(
      (option) => option.label === manualProject.projectName,
    );
    expect(manualOption).toBeDefined();
    act(() => result.current.handleSelectProjectOption(manualOption!.id));
    expect(result.current.selectedProject).toEqual(manualProject);

    rerender({
      routeProject: hydratedRouteProject,
      projects: [hydratedRouteProject, manualProject],
    });

    expect(result.current.selectedProject).toEqual(manualProject);
  });
});

describe("computeProjectOptionData", () => {
  const alpha = project({
    viewKey: "alpha",
    projectKey: "alpha",
    projectId: "a",
    projectName: "Alpha",
  });
  const beta = project({
    viewKey: "beta",
    projectKey: "beta",
    projectId: "b",
    projectName: "Beta",
  });
  const scratch = project({
    viewKey: "scratch",
    projectKey: "scratch",
    projectId: "s",
    projectName: "tmpworkspace",
  });
  const pinState = (sortAt: string, isDefault = false) => ({
    pinned: true,
    isDefault,
    sortAt,
    pinnedHosts: [],
    defaultHosts: [],
  });

  it("keeps the host order when no project is pinned", () => {
    const data = computeProjectOptionData([alpha, beta, scratch], {
      pinStates: new Map(),
      pinnedProjectOrder: [],
    });
    expect(data.options.map((option) => option.label)).toEqual(["Alpha", "Beta", "tmpworkspace"]);
    expect(data.pinnedOptionIds.size).toBe(0);
  });

  it("lists the Default project, then pinned projects, before the rest", () => {
    const data = computeProjectOptionData([alpha, beta, scratch], {
      pinStates: new Map([
        ["scratch", pinState("2026-10-02T00:00:00.000Z")],
        ["beta", pinState("2026-10-01T00:00:00.000Z", true)],
      ]),
      pinnedProjectOrder: [],
    });
    expect(data.options.map((option) => option.label)).toEqual(["Beta", "tmpworkspace", "Alpha"]);
    expect([...data.pinnedOptionIds].sort()).toEqual(["project:beta", "project:scratch"]);
    expect(data.projectByOptionId.get("project:scratch")).toBe(scratch);
  });
});
