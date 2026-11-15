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
  it("names the fork product, channel and feed, linking the fork's release tag", () => {
    const identity = resolveUpdateIdentity({
      runtime: FORK_RUNTIME,
      version: "0.10.0-beta.32",
      channel: "beta",
      published: { version: "0.10.0-beta.32", tag: "0.10.0-beta.32" },
    });
    expect(identity).toEqual({
      line: "Paseo Fork 0.10.0-beta.32 · beta channel · from tmad4000/paseo",
      version: "0.10.0-beta.32",
      releaseNotesUrl: "https://github.com/tmad4000/paseo/releases/tag/0.10.0-beta.32",
    });
    expect(formatUpdateWhatsNew(identity!)).toBe("What's new in 0.10.0-beta.32");
  });

  it("keeps an upstream build on its own name and feed, never the fork's", () => {
    const identity = resolveUpdateIdentity({
      runtime: UPSTREAM_RUNTIME,
      version: "v0.16.0",
      channel: "stable",
      published: { version: "0.16.0", tag: "v0.16.0" },
    });
    expect(identity?.line).toBe("Paseo 0.16.0 · stable channel · from getpaseo/paseo");
    expect(identity?.releaseNotesUrl).toBe(
      "https://github.com/getpaseo/paseo/releases/tag/v0.16.0",
    );
    expect(identity?.line).not.toContain("tmad4000");
  });

  it("links the releases list when the feed has not named a tag", () => {
    const identity = resolveUpdateIdentity({
      runtime: FORK_RUNTIME,
      version: "0.10.0-beta.33",
      channel: "beta",
      published: null,
    });
    expect(identity?.releaseNotesUrl).toBe("https://github.com/tmad4000/paseo/releases");
  });

  it("omits the source and link for a build without an update feed", () => {
    const identity = resolveUpdateIdentity({
      runtime: { productName: "Paseo Fork", updateSource: null },
      version: "0.10.0-beta.32",
      channel: "beta",
      published: null,
    });
    expect(identity).toEqual({
      line: "Paseo Fork 0.10.0-beta.32 · beta channel",
      version: "0.10.0-beta.32",
      releaseNotesUrl: null,
    });
  });

  it("claims nothing until the runtime names the product", () => {
    expect(
      resolveUpdateIdentity({
        runtime: { productName: null, updateSource: FORK_RUNTIME.updateSource },
        version: "0.10.0-beta.32",
        channel: "beta",
        published: null,
      }),
    ).toBeNull();
  });
});

describe("resolveReleaseTag", () => {
  it("uses the published tag for the published version", () => {
    expect(
      resolveReleaseTag("0.10.0-beta.32", { version: "0.10.0-beta.32", tag: "0.10.0-beta.32" }),
    ).toBe("0.10.0-beta.32");
  });

  it("follows the feed's prefix convention for another version", () => {
    expect(
      resolveReleaseTag("0.10.0-beta.31", { version: "0.10.0-beta.32", tag: "0.10.0-beta.32" }),
    ).toBe("0.10.0-beta.31");
    expect(resolveReleaseTag("0.15.4", { version: "0.16.0", tag: "v0.16.0" })).toBe("v0.15.4");
  });

  it("refuses to guess an unrecognized tag shape", () => {
    expect(resolveReleaseTag("0.15.4", { version: "0.16.0", tag: "release-0.16.0" })).toBeNull();
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
      "Agents keep running. This app didn't start the local daemon, so the restart leaves it on its current version.",
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
});
