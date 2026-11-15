import { readFileSync } from "node:fs";

const DEFAULT_PRODUCT_NAME = "Paseo";

// main.ts pins app.setName("Paseo") so the fork shares the upstream userData
// path; app.getName() therefore can't tell the builds apart. The fork's
// electron-builder config injects `paseoProductName` into the packaged
// package.json, and every other build reads as upstream Paseo.
export function readProductName(appPackageJsonPath: string): string {
  let raw: string;
  try {
    raw = readFileSync(appPackageJsonPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return DEFAULT_PRODUCT_NAME;
    throw error;
  }
  const manifest: unknown = JSON.parse(raw);
  if (typeof manifest !== "object" || manifest === null) return DEFAULT_PRODUCT_NAME;
  const name = "paseoProductName" in manifest ? manifest.paseoProductName : null;
  return typeof name === "string" && name.trim() ? name.trim() : DEFAULT_PRODUCT_NAME;
}
