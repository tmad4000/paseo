import { readFileSync } from "node:fs";

const DEFAULT_PRODUCT_NAME = "Paseo";

// main.ts pins app.setName("Paseo") so the fork shares the upstream userData
// path; app.getName() therefore can't tell the builds apart. The fork's
// electron-builder config injects `paseoProductName` into the packaged
// package.json, and every other build reads as upstream Paseo.
export function readProductName(appPackageJsonPath: string): string {
  // The name is cosmetic; an unreadable or malformed manifest must not fail
  // the runtime-info IPC that also carries the app version.
  try {
    const manifest: unknown = JSON.parse(readFileSync(appPackageJsonPath, "utf8"));
    if (typeof manifest !== "object" || manifest === null) return DEFAULT_PRODUCT_NAME;
    const name = "paseoProductName" in manifest ? manifest.paseoProductName : null;
    return typeof name === "string" && name.trim() ? name.trim() : DEFAULT_PRODUCT_NAME;
  } catch {
    return DEFAULT_PRODUCT_NAME;
  }
}
