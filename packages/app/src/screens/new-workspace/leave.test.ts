import { describe, expect, it, vi } from "vitest";

vi.mock("expo-router", () => ({ router: { replace: vi.fn() } }));
vi.mock("@/navigation/focus-history-runtime", () => ({ navigateBackInFocusHistory: vi.fn() }));
vi.mock("@/stores/navigation-active-workspace-store", () => ({
  navigateToLastWorkspace: vi.fn(),
}));

import { buildOpenProjectRoute } from "@/utils/host-routes";
import { leaveNewWorkspaceScreen, type LeaveNewWorkspaceDeps } from "./leave";

function deps(input: { back: boolean; lastWorkspace: boolean }) {
  return {
    navigateBack: vi.fn(() => input.back),
    navigateToLastWorkspace: vi.fn(() => input.lastWorkspace),
    replaceRoute: vi.fn(),
  } satisfies LeaveNewWorkspaceDeps;
}

describe("leaveNewWorkspaceScreen", () => {
  it("goes back to where the user came from", () => {
    const d = deps({ back: true, lastWorkspace: true });
    leaveNewWorkspaceScreen({ isCompact: false }, d);
    expect(d.navigateBack).toHaveBeenCalledWith({ isCompact: false });
    expect(d.navigateToLastWorkspace).not.toHaveBeenCalled();
    expect(d.replaceRoute).not.toHaveBeenCalled();
  });

  it("falls back to the last workspace when there is no history", () => {
    const d = deps({ back: false, lastWorkspace: true });
    leaveNewWorkspaceScreen({ isCompact: true }, d);
    expect(d.navigateToLastWorkspace).toHaveBeenCalled();
    expect(d.replaceRoute).not.toHaveBeenCalled();
  });

  it("falls back to Open project when there is no workspace to return to", () => {
    const d = deps({ back: false, lastWorkspace: false });
    leaveNewWorkspaceScreen({ isCompact: false }, d);
    expect(d.replaceRoute).toHaveBeenCalledWith(buildOpenProjectRoute());
  });
});
