import { beforeAll, describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import {
  formatUpdateRestartEffect,
  formatUpdateWhatsNew,
  resolvePublishedRelease,
  resolveReleaseTag,
  resolveUpdateIdentity,
  resolveUpdateRestartEffect,
} from "./update-identity";

const FORK_RUNTIME = {
  productName: "Paseo Fork",
  updateSource: { owner: "tmad4000", repo: "paseo" },
};
const UPSTREAM_RUNTIME = {
  productName: "Paseo",
  updateSource: { owner: "getpaseo", repo: "paseo" },
};

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

describe("resolveUpdateIdentity", () => {
  it("names an offered fork update by product, channel and feed, linking its release tag", () => {
    const identity = resolveUpdateIdentity({
      runtime: FORK_RUNTIME,
      role: "update",
      version: "0.10.0-beta.33",
      channel: "beta",
      published: { version: "0.10.0-beta.33", tag: "0.10.0-beta.33" },
    });
    expect(identity).toEqual({
      line: "Update: Paseo Fork v0.10.0-beta.33 · beta channel · from tmad4000/paseo",
      version: "v0.10.0-beta.33",
      releaseNotesUrl: "https://github.com/tmad4000/paseo/releases/tag/0.10.0-beta.33",
    });
    expect(formatUpdateWhatsNew(identity!)).toBe("What's new in v0.10.0-beta.33");
  });

  it("names the installed build without the Update prefix", () => {
    const identity = resolveUpdateIdentity({
      runtime: FORK_RUNTIME,
      role: "installed",
      version: "0.10.0-beta.32",
      channel: "beta",
      published: { version: "0.10.0-beta.32", tag: "0.10.0-beta.32" },
    });
    expect(identity?.line).toBe("Paseo Fork v0.10.0-beta.32 · beta channel · from tmad4000/paseo");
    expect(identity?.releaseNotesUrl).toBe(
      "https://github.com/tmad4000/paseo/releases/tag/0.10.0-beta.32",
    );
  });

  it("links the releases list for a version the feed did not return", () => {
    const identity = resolveUpdateIdentity({
      runtime: FORK_RUNTIME,
      role: "installed",
      version: "0.10.0-beta.30",
      channel: "beta",
      published: { version: "0.10.0-beta.32", tag: "0.10.0-beta.32" },
    });
    expect(identity?.releaseNotesUrl).toBe("https://github.com/tmad4000/paseo/releases");
  });

  it("translates the line with the active language", async () => {
    await i18n.changeLanguage("es");
    try {
      const identity = resolveUpdateIdentity({
        runtime: FORK_RUNTIME,
        role: "update",
        version: "0.10.0-beta.33",
        channel: "beta",
        published: null,
      });
      expect(identity?.line).toBe(
        "Actualización: Paseo Fork v0.10.0-beta.33 · canal beta · de tmad4000/paseo",
      );
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("keeps an upstream build on its own name and feed, never the fork's", () => {
    const identity = resolveUpdateIdentity({
      runtime: UPSTREAM_RUNTIME,
      role: "update",
      version: "v0.16.0",
      channel: "stable",
      published: { version: "0.16.0", tag: "v0.16.0" },
    });
    expect(identity?.line).toBe("Update: Paseo v0.16.0 · stable channel · from getpaseo/paseo");
    expect(identity?.releaseNotesUrl).toBe(
      "https://github.com/getpaseo/paseo/releases/tag/v0.16.0",
    );
    expect(identity?.line).not.toContain("tmad4000");
  });

  it("links the releases list when the feed has not named a tag", () => {
    const identity = resolveUpdateIdentity({
      runtime: FORK_RUNTIME,
      role: "update",
      version: "0.10.0-beta.33",
      channel: "beta",
      published: null,
    });
    expect(identity?.releaseNotesUrl).toBe("https://github.com/tmad4000/paseo/releases");
  });

  it("omits the source and link for a build without an update feed", () => {
    const identity = resolveUpdateIdentity({
      runtime: { productName: "Paseo Fork", updateSource: null },
      role: "installed",
      version: "0.10.0-beta.32",
      channel: "beta",
      published: null,
    });
    expect(identity).toEqual({
      line: "Paseo Fork v0.10.0-beta.32 · beta channel",
      version: "v0.10.0-beta.32",
      releaseNotesUrl: null,
    });
  });

  it("claims nothing until the runtime names the product", () => {
    expect(
      resolveUpdateIdentity({
        runtime: { productName: null, updateSource: FORK_RUNTIME.updateSource },
        role: "update",
        version: "0.10.0-beta.32",
        channel: "beta",
        published: null,
      }),
    ).toBeNull();
  });
});

describe("resolveReleaseTag", () => {
  it("uses the feed's tag only for the release the feed returned", () => {
    const published = { version: "0.10.0-beta.32", tag: "0.10.0-beta.32" };
    expect(resolveReleaseTag("v0.10.0-beta.32", published)).toBe("0.10.0-beta.32");
    expect(resolveReleaseTag("0.16.0", { version: "0.16.0", tag: "v0.16.0" })).toBe("v0.16.0");
  });

  it("never guesses a tag for another version, since fork tags skip versions", () => {
    const published = { version: "0.10.0-beta.32", tag: "0.10.0-beta.32" };
    expect(resolveReleaseTag("0.10.0-beta.30", published)).toBeNull();
  });
});

describe("resolvePublishedRelease", () => {
  it("needs both the published version and its tag", () => {
    expect(resolvePublishedRelease({ publishedVersion: "1.0.0", publishedTag: "v1.0.0" })).toEqual({
      version: "1.0.0",
      tag: "v1.0.0",
    });
    expect(resolvePublishedRelease({ publishedVersion: "1.0.0", publishedTag: null })).toBeNull();
    expect(resolvePublishedRelease(null)).toBeNull();
  });
});

describe("resolveUpdateRestartEffect", () => {
  it("says local agents stop when this app launched the daemon", () => {
    const effect = resolveUpdateRestartEffect({
      daemon: { status: "running", ownedByDesktop: true },
      keepRunningAfterQuit: false,
    });
    expect(effect).toBe("agentsStop");
    expect(formatUpdateRestartEffect(effect)).toBe(
      "Local agents and terminals stop during the restart. The daemon restarts with the app.",
    );
  });

  it("does not let Keep daemon running after quit promise survival through an update", () => {
    const effect = resolveUpdateRestartEffect({
      daemon: { status: "running", ownedByDesktop: true },
      keepRunningAfterQuit: true,
    });
    expect(effect).toBe("agentsStopKeepRunningOn");
    expect(formatUpdateRestartEffect(effect)).toContain(
      "even with Keep daemon running after quit on",
    );
  });

  it("says agents keep running when the daemon was started outside this app", () => {
    const effect = resolveUpdateRestartEffect({
      daemon: { status: "running", ownedByDesktop: false },
      keepRunningAfterQuit: false,
    });
    expect(effect).toBe("agentsKeepRunning");
    expect(formatUpdateRestartEffect(effect)).toBe(
      "Agents keep running. This app session didn't start the local daemon, so it stays on its current version.",
    );
  });

  it("says nothing stops when no local daemon runs, and hedges only while unknown", () => {
    expect(
      resolveUpdateRestartEffect({
        daemon: { status: "stopped", ownedByDesktop: false },
        keepRunningAfterQuit: true,
      }),
    ).toBe("noDaemon");
    expect(resolveUpdateRestartEffect({ daemon: null, keepRunningAfterQuit: false })).toBe(
      "unknown",
    );
  });

  it("does not promise survival when the status probe errored, since the daemon may be alive", () => {
    const effect = resolveUpdateRestartEffect({
      daemon: { status: "errored", ownedByDesktop: false },
      keepRunningAfterQuit: false,
    });
    expect(effect).toBe("unknown");
    expect(formatUpdateRestartEffect(effect)).toBe(
      "Agents in the daemon this app started stop during the restart.",
    );
  });
});
