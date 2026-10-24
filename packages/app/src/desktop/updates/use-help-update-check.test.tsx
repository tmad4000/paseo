/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHelpUpdateCheck } from "./use-help-update-check";
import type { DesktopAppUpdateCheckResult, DesktopReleaseChannel } from "./desktop-updates";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
const ready: DesktopAppUpdateCheckResult = {
  currentVersion: "1.2.3",
  latestVersion: "1.2.4",
  publishedVersion: "1.2.4",
  hasUpdate: true,
  readyToInstall: true,
  body: null,
  date: null,
  errorMessage: null,
};

describe("Help menu update-check lifecycle", () => {
  let root: Root;
  let container: HTMLElement;
  let value: ReturnType<typeof useHelpUpdateCheck>;
  const checkForUpdates = vi.fn<() => Promise<DesktopAppUpdateCheckResult | null>>();
  function Probe({ open, channel }: { open: boolean; channel: DesktopReleaseChannel }) {
    value = useHelpUpdateCheck({
      open,
      releaseChannel: channel,
      isDesktopApp: true,
      checkForUpdates,
    });
    return null;
  }
  async function render(open: boolean, channel: DesktopReleaseChannel = "beta") {
    await act(async () => {
      root.render(<Probe open={open} channel={channel} />);
    });
  }
  beforeEach(() => {
    checkForUpdates.mockReset();
    container = document.createElement("div");
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("removes beta readiness while a stable check is delayed, then rejected", async () => {
    checkForUpdates.mockResolvedValueOnce(ready);
    await render(true);
    expect(value!.canInstall).toBe(true);
    let reject!: (error: Error) => void;
    checkForUpdates.mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    );
    await render(true, "stable");
    expect(value!.canInstall).toBe(false);
    expect(value!.releaseCheck.state).toBe("checking");
    await act(async () => {
      reject(new Error("bridge unavailable"));
    });
    expect(value!.canInstall).toBe(false);
    expect(value!.releaseCheck.state).toBe("unknown");
  });

  it("ignores an old response after closing and reopening the menu", async () => {
    let resolveOld!: (result: DesktopAppUpdateCheckResult) => void;
    checkForUpdates.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    await render(true);
    await render(false);
    checkForUpdates.mockResolvedValueOnce(null);
    await render(true);
    await act(async () => {
      resolveOld(ready);
    });
    expect(value!.canInstall).toBe(false);
    expect(value!.releaseCheck.state).toBe("unknown");
  });

  it("invalidates a previous success when the next result carries a feed error", async () => {
    checkForUpdates.mockResolvedValueOnce(ready);
    await render(true);
    await render(false);
    checkForUpdates.mockResolvedValueOnce({ ...ready, errorMessage: "feed failed" });
    await render(true);
    expect(value!.canInstall).toBe(false);
    expect(value!.releaseCheck.state).toBe("unknown");
  });
});
