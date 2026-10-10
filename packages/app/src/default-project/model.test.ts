import { describe, expect, it } from "vitest";
import {
  orderProjectsWithPins,
  resolveDefaultProjectPlacements,
  resolveDefaultProjectWorkspaceId,
  resolveProjectPinState,
  selectHostDefaultProject,
  splitPinnedProjects,
  type ProjectPinFields,
  type ProjectPinState,
} from "./model";

function pinState(overrides: Partial<ProjectPinState> = {}): ProjectPinState {
  return {
    pinned: true,
    isDefault: false,
    sortAt: "2026-10-01T00:00:00.000Z",
    pinnedHosts: [],
    defaultHosts: [],
    ...overrides,
  };
}

describe("selectHostDefaultProject", () => {
  it("returns null when the host has no Default project", () => {
    expect(selectHostDefaultProject([{ projectId: "a" }, { projectId: "b" }])).toBeNull();
  });

  it("takes the newest default when a race left two", () => {
    const projects: ProjectPinFields[] = [
      { projectId: "old", projectDefaultAt: "2026-10-01T00:00:00.000Z" },
      { projectId: "new", projectDefaultAt: "2026-10-09T00:00:00.000Z" },
      { projectId: "plain" },
    ];
    expect(selectHostDefaultProject(projects)?.projectId).toBe("new");
  });
});

describe("resolveProjectPinState", () => {
  const projects = new Map<string, ProjectPinFields>([
    ["m4:tmp", { projectId: "tmp", projectDefaultAt: "2026-10-05T00:00:00.000Z" }],
    ["m4:repo", { projectId: "repo", projectPinnedAt: "2026-10-02T00:00:00.000Z" }],
    ["m3:repo-m3", { projectId: "repo-m3", projectPinnedAt: "2026-10-03T00:00:00.000Z" }],
    ["m4:plain", { projectId: "plain" }],
  ]);
  const getProject = (host: { serverId: string; projectId: string }) =>
    projects.get(`${host.serverId}:${host.projectId}`);
  const defaults = new Map([["m4", "tmp"]]);

  it("treats the Default project as pinned even without a pin", () => {
    expect(
      resolveProjectPinState({
        hosts: [{ serverId: "m4", projectId: "tmp" }],
        getProject,
        defaultProjectIdByServerId: defaults,
      }),
    ).toMatchObject({ pinned: true, isDefault: true, sortAt: "2026-10-05T00:00:00.000Z" });
  });

  it("is pinned when any host in the group pins it, sorting by the newest pin", () => {
    const state = resolveProjectPinState({
      hosts: [
        { serverId: "m4", projectId: "repo" },
        { serverId: "m3", projectId: "repo-m3" },
      ],
      getProject,
      defaultProjectIdByServerId: defaults,
    });
    expect(state).toMatchObject({ pinned: true, isDefault: false });
    expect(state?.sortAt).toBe("2026-10-03T00:00:00.000Z");
    expect(state?.pinnedHosts).toHaveLength(2);
  });

  it("returns null for a project that is neither pinned nor default", () => {
    expect(
      resolveProjectPinState({
        hosts: [{ serverId: "m4", projectId: "plain" }],
        getProject,
        defaultProjectIdByServerId: defaults,
      }),
    ).toBeNull();
  });
});

describe("orderProjectsWithPins", () => {
  const projects = ["a", "b", "c", "d", "e"].map((viewKey) => ({ viewKey }));

  it("leaves the order alone when nothing is pinned", () => {
    const result = orderProjectsWithPins({ projects, pinStates: new Map(), pinnedProjectOrder: [] });
    expect(result.projects.map((project) => project.viewKey)).toEqual(["a", "b", "c", "d", "e"]);
    expect(result.pinnedViewKeys.size).toBe(0);
  });

  it("puts Default first, then most recently pinned, above unpinned projects", () => {
    const pinStates = new Map([
      ["b", pinState({ sortAt: "2026-10-02T00:00:00.000Z" })],
      ["d", pinState({ sortAt: "2026-10-04T00:00:00.000Z" })],
      ["e", pinState({ isDefault: true, sortAt: "2026-10-01T00:00:00.000Z" })],
    ]);
    const result = orderProjectsWithPins({ projects, pinStates, pinnedProjectOrder: [] });
    expect(result.projects.map((project) => project.viewKey)).toEqual(["e", "d", "b", "a", "c"]);
    expect([...result.pinnedViewKeys]).toEqual(["e", "d", "b"]);
  });

  it("honors the drag order among pinned projects but keeps Default first", () => {
    const pinStates = new Map([
      ["b", pinState({ sortAt: "2026-10-02T00:00:00.000Z" })],
      ["d", pinState({ sortAt: "2026-10-04T00:00:00.000Z" })],
      ["e", pinState({ isDefault: true, sortAt: "2026-10-01T00:00:00.000Z" })],
    ]);
    const result = orderProjectsWithPins({
      projects,
      pinStates,
      pinnedProjectOrder: ["b", "e", "d"],
    });
    expect(result.projects.map((project) => project.viewKey)).toEqual(["e", "b", "d", "a", "c"]);
  });

  it("splits an ordered list back into the pinned head and the rest", () => {
    expect(splitPinnedProjects(projects, new Set(["b", "d"]))).toEqual({
      pinned: [{ viewKey: "b" }, { viewKey: "d" }],
      rest: [{ viewKey: "a" }, { viewKey: "c" }, { viewKey: "e" }],
    });
  });
});

describe("resolveDefaultProjectPlacements", () => {
  it("maps each host's default to the grouped sidebar project", () => {
    expect(
      resolveDefaultProjectPlacements({
        projects: [
          { viewKey: "tmp-view", hosts: [{ serverId: "m4", projectId: "tmp" }] },
          {
            viewKey: "repo-view",
            hosts: [
              { serverId: "m4", projectId: "repo" },
              { serverId: "m3", projectId: "repo-m3" },
            ],
          },
        ],
        defaultProjectIdByServerId: new Map([
          ["m4", "tmp"],
          ["m3", "repo-m3"],
        ]),
      }),
    ).toEqual([
      { serverId: "m4", projectViewKey: "tmp-view" },
      { serverId: "m3", projectViewKey: "repo-view" },
    ]);
  });
});

describe("resolveDefaultProjectWorkspaceId", () => {
  const base = {
    projectId: "tmp",
    workspaceDirectory: "/tmpworkspace",
    projectRootPath: "/tmpworkspace",
    statusEnteredAt: null,
    archivingAt: null,
  };

  it("opens the workspace with the most recent agent activity", () => {
    expect(
      resolveDefaultProjectWorkspaceId({
        projectId: "tmp",
        workspaces: [
          { ...base, id: "old" },
          { ...base, id: "recent" },
          { ...base, id: "other-project", projectId: "repo" },
        ],
        lastActivityAtByWorkspaceId: new Map([
          ["old", new Date("2026-10-01T00:00:00.000Z")],
          ["recent", new Date("2026-10-09T00:00:00.000Z")],
          ["other-project", new Date("2026-10-10T00:00:00.000Z")],
        ]),
      }),
    ).toBe("recent");
  });

  it("falls back to the root checkout, and to null when the project has no workspace", () => {
    expect(
      resolveDefaultProjectWorkspaceId({
        projectId: "tmp",
        workspaces: [
          { ...base, id: "nested", workspaceDirectory: "/tmpworkspace/sub" },
          { ...base, id: "root" },
          { ...base, id: "archiving", archivingAt: "2026-10-10T00:00:00.000Z" },
        ],
        lastActivityAtByWorkspaceId: new Map(),
      }),
    ).toBe("root");
    expect(
      resolveDefaultProjectWorkspaceId({
        projectId: "tmp",
        workspaces: [],
        lastActivityAtByWorkspaceId: new Map(),
      }),
    ).toBeNull();
  });
});
