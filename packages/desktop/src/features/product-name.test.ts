import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readProductName } from "./product-name";

describe("readProductName", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "product-name-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeManifest(manifest: object): string {
    const file = path.join(dir, "package.json");
    writeFileSync(file, JSON.stringify(manifest));
    return file;
  }

  it("names the fork from the product name its build injects", () => {
    const file = writeManifest({ name: "@getpaseo/desktop", paseoProductName: "Paseo Fork" });
    expect(readProductName(file)).toBe("Paseo Fork");
  });

  it("reads as Paseo for upstream and unpackaged builds", () => {
    expect(readProductName(writeManifest({ name: "@getpaseo/desktop" }))).toBe("Paseo");
    expect(readProductName(path.join(dir, "missing.json"))).toBe("Paseo");
  });

  it("matches what the fork builder config injects", async () => {
    const fork = (await import("../../electron-builder.fork.cjs")).default as {
      extraMetadata: Record<string, unknown>;
    };
    const file = writeManifest({ name: "@getpaseo/desktop", ...fork.extraMetadata });
    expect(readProductName(file)).toBe("Paseo Fork");
  });
});
