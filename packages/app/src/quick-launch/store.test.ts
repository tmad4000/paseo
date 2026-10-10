import { afterEach, describe, expect, it } from "vitest";
import { openQuickLaunch, useQuickLaunchStore } from "./store";

afterEach(() => {
  useQuickLaunchStore.getState().close();
});

describe("openQuickLaunch", () => {
  it("opens a session carrying the requested prompt and destination", () => {
    openQuickLaunch({
      prompt: "Fix the flaky test",
      destination: { kind: "workspace", serverId: "m4", workspaceId: "ws-1" },
      startAndOpen: true,
    });

    expect(useQuickLaunchStore.getState().session?.request).toEqual({
      prompt: "Fix the flaky test",
      destination: { kind: "workspace", serverId: "m4", workspaceId: "ws-1" },
      startAndOpen: true,
    });
  });

  it("keeps an open dialog when reopened with nothing new", () => {
    openQuickLaunch({ prompt: "First" });
    const opened = useQuickLaunchStore.getState().session;

    openQuickLaunch();

    expect(useQuickLaunchStore.getState().session).toBe(opened);
  });

  it("replaces an open dialog when reopened with a new prompt", () => {
    openQuickLaunch();
    const opened = useQuickLaunchStore.getState().session;

    openQuickLaunch({ prompt: "From the find field" });

    const replaced = useQuickLaunchStore.getState().session;
    expect(replaced?.id).not.toBe(opened?.id);
    expect(replaced?.request).toEqual({ prompt: "From the find field" });
  });
});
