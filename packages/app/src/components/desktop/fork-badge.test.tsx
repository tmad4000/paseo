/** @vitest-environment jsdom */
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import { ForkVersionIndicator } from "./fork-badge";

const state = vi.hoisted(() => ({
  check: { state: "checked", latestVersion: "0.10.0-beta.20" } as
    | { state: "checked"; latestVersion: string }
    | { state: "unknown" | "checking" },
  result: { currentVersion: "0.10.0-beta.19", readyToInstall: true } as {
    currentVersion: string;
    readyToInstall: boolean;
    publishedVersion?: string;
    publishedTag?: string;
  } | null,
  refresh: vi.fn(),
  openExternalUrl: vi.fn(),
}));
vi.mock("@/desktop/updates/use-fork-update-check", () => ({ useForkUpdateCheck: () => state }));
vi.mock("@/desktop/settings/desktop-settings", () => ({
  useDesktopSettings: () => ({ settings: { releaseChannel: "beta" }, isLoading: false }),
}));
vi.mock("@/runtime/host-runtime", () => ({
  useHosts: () => [{ serverId: "m4", label: "M4" }],
  useHostRuntimeIsConnected: () => true,
  useHostRuntimeSnapshot: () => ({
    client: { getLastServerInfoMessage: () => ({ version: "0.10.0-beta.18" }) },
  }),
}));
vi.mock("@/utils/desktop-window", () => ({
  useCustomDesktopWindowControls: () => ({ visible: false, mode: null }),
}));
vi.mock("@/utils/app-version", () => ({ resolveAppVersion: () => "0.10.0-beta.19" }));
vi.mock("@/changelog", () => ({ openChangelog: vi.fn() }));
vi.mock("@/utils/open-external-url", () => ({ openExternalUrl: state.openExternalUrl }));
// The runtime query needs Electron IPC; feed the real identity resolver the fork's runtime facts.
vi.mock("@/desktop/updates/use-update-identity", async () => {
  const identity = await import("@/desktop/updates/update-identity");
  return {
    useUpdateIdentity: (
      version: string | null | undefined,
      result: { publishedVersion?: string | null; publishedTag?: string | null } | null,
    ) =>
      version
        ? identity.resolveUpdateIdentity({
            runtime: {
              productName: "Paseo Fork",
              updateSource: { owner: "tmad4000", repo: "paseo" },
            },
            version,
            channel: "beta",
            published: identity.resolvePublishedRelease(result),
          })
        : null,
  };
});
vi.mock("@/constants/layout", () => ({
  getIsElectronRuntime: () => true,
  HEADER_INNER_HEIGHT: 44,
  DESKTOP_WINDOW_CONTROLS_HEIGHT: 44,
  FORK_BADGE_WIDTH: 252,
  useIsCompactFormFactor: () => false,
}));

beforeEach(async () => {
  vi.stubGlobal("React", React);
  await i18n.changeLanguage("en");
  state.check = { state: "checked", latestVersion: "0.10.0-beta.20" };
  state.result = { currentVersion: "0.10.0-beta.19", readyToInstall: true };
  state.refresh.mockClear();
  state.openExternalUrl.mockClear();
});
afterEach(cleanup);

describe("Fork version control", () => {
  it("exposes the installed client and readiness on an accessible trigger, and distinct daemon details on press", async () => {
    render(<ForkVersionIndicator />);
    const trigger = screen.getByRole("button", {
      name: "Paseo Fork app v0.10.0-beta.19 · Ready to install",
    });
    expect(trigger.textContent).toContain("Ready");
    fireEvent.click(trigger);
    expect((await screen.findByText("Connected hosts (daemon versions)")).textContent).toBe(
      "Connected hosts (daemon versions)",
    );
    expect(screen.getByText("v0.10.0-beta.18").textContent).toBe("v0.10.0-beta.18");
    fireEvent.click(screen.getByText("Check for updates"));
    expect(state.refresh).toHaveBeenCalledTimes(1);
  });
  it("names the offered update's product, channel and feed, and opens its release page", async () => {
    state.result = {
      currentVersion: "0.10.0-beta.19",
      readyToInstall: true,
      publishedVersion: "0.10.0-beta.20",
      publishedTag: "0.10.0-beta.20",
    };
    render(<ForkVersionIndicator />);
    fireEvent.click(screen.getByTestId("fork-version-trigger"));
    expect((await screen.findByTestId("fork-update-identity")).textContent).toBe(
      "Paseo Fork 0.10.0-beta.20 · beta channel · from tmad4000/paseo",
    );
    fireEvent.click(screen.getByText("What's new in 0.10.0-beta.20"));
    expect(state.openExternalUrl).toHaveBeenCalledWith(
      "https://github.com/tmad4000/paseo/releases/tag/0.10.0-beta.20",
    );
  });
  it("shows failure as Unknown, and a build ahead of the feed as Newer", () => {
    state.check = { state: "unknown" };
    state.result = null;
    const { rerender } = render(<ForkVersionIndicator />);
    expect(screen.getByRole("button", { name: /Couldn’t check/ }).textContent).toContain("Unknown");
    state.check = { state: "checked", latestVersion: "0.10.0-beta.18" };
    rerender(<ForkVersionIndicator />);
    expect(screen.getByRole("button", { name: /Newer than release/ }).textContent).toContain(
      "Newer",
    );
  });
});
