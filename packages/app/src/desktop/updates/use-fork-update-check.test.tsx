/** @vitest-environment jsdom */
import React, { act } from "react";
import { renderHook, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useForkUpdateCheck, FORK_CHECK_INTERVAL_MS } from "./use-fork-update-check";
import { checkDesktopAppUpdate, type DesktopAppUpdateCheckResult } from "./desktop-updates";
import { resolveVersionStatus } from "./version-status";
vi.mock("./desktop-updates", () => ({ checkDesktopAppUpdate: vi.fn() }));
const port = vi.mocked(checkDesktopAppUpdate);
const ready: DesktopAppUpdateCheckResult = {
  currentVersion: "0.10.0-beta.19",
  latestVersion: "0.10.0-beta.20",
  publishedVersion: "0.10.0-beta.20",
  hasUpdate: true,
  readyToInstall: true,
  body: null,
  date: null,
  errorMessage: null,
};
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.useFakeTimers();
  port.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
async function settle() {
  await act(async () => {});
}

describe("Fork titlebar release checks", () => {
  it("checks automatically, distinguishes client and host, and refreshes on the interval", async () => {
    port.mockResolvedValue(ready);
    const { result } = renderHook(() => useForkUpdateCheck("beta"));
    await settle();
    expect(port).toHaveBeenCalledWith({ releaseChannel: "beta", intent: "automatic" });
    expect(resolveVersionStatus(result.current.result!.currentVersion, result.current.check)).toBe(
      "update",
    );
    expect(resolveVersionStatus("0.10.0-beta.20", result.current.check)).toBe("current");
    await act(async () => {
      vi.advanceTimersByTime(FORK_CHECK_INTERVAL_MS);
    });
    expect(port).toHaveBeenCalledTimes(2);
  });
  it("invalidates old success while checking and exposes failure instead of claiming current", async () => {
    port.mockResolvedValueOnce({
      ...ready,
      currentVersion: ready.publishedVersion!,
      hasUpdate: false,
      readyToInstall: false,
    });
    const { result } = renderHook(() => useForkUpdateCheck("beta"));
    await settle();
    expect(resolveVersionStatus(ready.publishedVersion!, result.current.check)).toBe("current");
    port.mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.check).toEqual({ state: "unknown" });
    expect(result.current.result).toBeNull();
    expect(port).toHaveBeenLastCalledWith({ releaseChannel: "beta", intent: "manual" });
  });
  it("ignores delayed old-channel responses and errors carried by the feed", async () => {
    let oldResolve!: (value: DesktopAppUpdateCheckResult) => void;
    port.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          oldResolve = resolve;
        }),
    );
    const { result, rerender } = renderHook(
      ({ channel }: { channel: "stable" | "beta" }) => useForkUpdateCheck(channel),
      { initialProps: { channel: "beta" } },
    );
    port.mockResolvedValueOnce({ ...ready, errorMessage: "feed failed" });
    rerender({ channel: "stable" });
    await settle();
    await act(async () => {
      oldResolve(ready);
    });
    expect(result.current.check).toEqual({ state: "unknown" });
    expect(result.current.result).toBeNull();
  });
});
