import { describe, expect, it } from "vitest";
import { resolveVersionStatus, type ReleaseVersionCheck } from "./version-status";

const checked = (latestVersion: string | null): ReleaseVersionCheck => ({
  state: "checked",
  latestVersion,
});

describe("Help menu version status", () => {
  it("compares each host independently against the checked release", () => {
    const release = checked("0.10.0-beta.16");
    expect(resolveVersionStatus("v0.10.0-beta.16", release)).toBe("current");
    expect(resolveVersionStatus("0.10.0-beta.14", release)).toBe("update");
    expect(resolveVersionStatus("0.10.0-beta.17", release)).toBe("ahead");
  });

  it("orders numeric prereleases, stable releases, and build metadata correctly", () => {
    expect(resolveVersionStatus("0.10.0-beta.9", checked("0.10.0-beta.10"))).toBe("update");
    expect(resolveVersionStatus("0.10.0-beta.16", checked("0.10.0"))).toBe("update");
    expect(resolveVersionStatus("0.10.0", checked("0.10.0-beta.16"))).toBe("ahead");
    expect(resolveVersionStatus("0.10.0+local", checked("0.10.0"))).toBe("current");
    expect(resolveVersionStatus("0.9.9", checked("0.10.0"))).toBe("update");
  });

  it("does not claim latest when disconnected, unchecked, checking or unparseable", () => {
    expect(resolveVersionStatus("0.10.0", checked("0.10.0"), false)).toBe("offline");
    expect(resolveVersionStatus("0.10.0", { state: "unknown" })).toBe("unknown");
    expect(resolveVersionStatus("0.10.0", { state: "checking" })).toBe("checking");
    expect(resolveVersionStatus(null, checked("0.10.0"))).toBe("unknown");
    expect(resolveVersionStatus("custom", checked("0.10.0"))).toBe("unknown");
    expect(resolveVersionStatus("0.10.0", checked(null))).toBe("unknown");
  });
});
