import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseUpdateSource, readUpdateSource } from "./update-source";

describe("parseUpdateSource", () => {
  it("names the fork feed from the generated app-update.yml", () => {
    const yml =
      "owner: tmad4000\nrepo: paseo\nprovider: github\nupdaterCacheDirName: paseo-updater\n";
    expect(parseUpdateSource(yml)).toEqual({ owner: "tmad4000", repo: "paseo" });
  });

  it("names the upstream feed for an upstream build", () => {
    const yml = "provider: github\nowner: getpaseo\nrepo: 'paseo'\n";
    expect(parseUpdateSource(yml)).toEqual({ owner: "getpaseo", repo: "paseo" });
  });

  it("claims no source for a non-GitHub or incomplete feed", () => {
    expect(parseUpdateSource("provider: generic\nurl: https://example.com\n")).toBeNull();
    expect(parseUpdateSource("provider: github\nowner: tmad4000\n")).toBeNull();
  });
});

describe("readUpdateSource", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it("returns null when the build has no feed file", () => {
    dir = mkdtempSync(path.join(tmpdir(), "update-source-"));
    expect(readUpdateSource(path.join(dir, "app-update.yml"))).toBeNull();
  });

  it("reads the feed file from disk", () => {
    dir = mkdtempSync(path.join(tmpdir(), "update-source-"));
    const file = path.join(dir, "app-update.yml");
    writeFileSync(file, "owner: tmad4000\nrepo: paseo\nprovider: github\n");
    expect(readUpdateSource(file)).toEqual({ owner: "tmad4000", repo: "paseo" });
  });
});
